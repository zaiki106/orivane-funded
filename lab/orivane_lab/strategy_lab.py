"""Independent strategy research, confined to development; never promotes signals."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path
from .storage import DEFAULT_ROOT, BudgetWrite, ProcessLock, atomic_json, initialize, utc_now

EMBARGO = 16 * 900_000


def build_events(dataset: Path, root: Path=DEFAULT_ROOT):
    root=initialize(root)
    candidates=[Path(__file__).resolve().parents[2]/p for p in ('orivane-funded/src/export-strategy-lab.mjs','src/export-strategy-lab.mjs')]
    exporter=next((p for p in candidates if p.is_file()),None)
    if exporter is None: raise ValueError('Portable strategy exporter not found')
    dataset=dataset.resolve()
    source_hash=hashlib.sha256(dataset.read_bytes()).hexdigest()[:16]
    output=root/'experiments'/f'independent-events-{source_hash}.ndjson'
    with ProcessLock(root),BudgetWrite(root,1_100_000_000):
        if output.exists() or Path(str(output)+'.partial').exists():
            raise ValueError(f'Export already exists; sources preserved: {output}')
        subprocess.run(['node',str(exporter),str(dataset),str(output)],check=True)
    return output


def purged_rows(rows, start, end, aligned=True):
    selected, busy = [], -math.inf
    for row in sorted(rows, key=lambda r: (r["entryTimeMs"], r["labelEndTimeMs"] or math.inf)):
        if row["censored"] or row["y"] not in (0, 1) or aligned and not row["h1Aligned"]:
            continue
        if start <= row["entryTimeMs"] < end and row["labelEndTimeMs"] < end and row["entryTimeMs"] > busy:
            selected.append(row)
            busy = row["labelEndTimeMs"]
    return selected


def metrics(rows):
    if not rows:
        return {"n": 0, "target": 0, "stop": 0, "expired": 0, "targetRate": None, "netExpectancyR": None, "profitFactor": None, "maxDrawdownR": None}
    values = [r["netR"] for r in rows]
    equity, peak, drawdown = 0., 0., 0.
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    gain, loss = sum(max(0, v) for v in values), -sum(min(0, v) for v in values)
    return {"n": len(rows), "target": sum(r["status"] == "target" for r in rows), "stop": sum(r["status"] == "stop" for r in rows),
        "expired": sum(r["status"] == "expired" for r in rows), "targetRate": sum(r["y"] for r in rows)/len(rows),
        "netExpectancyR": sum(values)/len(rows), "profitFactor": gain/loss if loss else None, "maxDrawdownR": drawdown}


def block_evidence(values, repetitions=4999, block=8, seed=72):
    """Circular blocks of eight consecutive trades; bounded temporary memory."""
    import numpy as np
    x = np.asarray(values, dtype=float)
    if len(x) < 30:
        return {"interval": None, "pValue": 1.0, "blockTrades": block, "repetitions": repetitions}
    rng, means = np.random.default_rng(seed), []
    for offset in range(0, repetitions, 100):
        count = min(100, repetitions-offset)
        starts = rng.integers(0, len(x), size=(count, math.ceil(len(x)/block), 1))
        indices = ((starts + np.arange(block)) % len(x)).reshape(count, -1)[:, :len(x)]
        means.extend(x[indices].mean(axis=1))
    means = np.asarray(means)
    interval = np.quantile(means, [.025, .975]).tolist()
    p = float((1 + np.sum(means - x.mean() >= x.mean()))/(repetitions+1))
    return {"interval": interval, "pValue": p, "blockTrades": block, "repetitions": repetitions}


def holm_adjust(pvalues):
    ordered = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, previous = [1.] * len(pvalues), 0.
    for rank, index in enumerate(ordered):
        previous = max(previous, min(1., pvalues[index]*(len(pvalues)-rank)))
        adjusted[index] = previous
    return adjusted


def windows(manifest):
    start, end = manifest["fromMs"], manifest["throughMs"]
    # Align every boundary to 15m. No calibration/final-test row is accessible.
    cuts = [int((start+(end-start)*f)//900000)*900000 for f in (.4,.6,.8,1)]
    return [{"fitFromMs": start, "fitEndMs": a, "testFromMs": a+EMBARGO, "testEndMs": b} for a,b in zip(cuts,cuts[1:])]


def run(events_path: Path, root: Path = DEFAULT_ROOT):
    import duckdb
    import optuna
    root = initialize(root)
    manifest = json.loads(Path(str(events_path)+'.manifest.json').read_text(encoding='utf-8'))
    if manifest.get('kind') != 'independent-strategy-development-events' or manifest.get('usesFinalTest') is not False or manifest['throughMs'] > manifest['developmentBoundaryMs']:
        raise ValueError('Only bounded development events are accepted')
    digest = hashlib.sha256()
    with events_path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4_000_000), b''): digest.update(chunk)
    if digest.hexdigest() != manifest['eventsSha256']: raise ValueError('Event SHA256 mismatch')
    identifier = digest.hexdigest()[:16]
    with ProcessLock(root), BudgetWrite(root, events_path.stat().st_size*2+50_000_000):
        con = duckdb.connect()
        con.execute('SET threads=4')
        con.execute("CREATE TABLE events AS SELECT * FROM read_ndjson_auto(?)", [str(events_path.resolve())])
        rows = con.execute('SELECT * FROM events ORDER BY entryTimeMs, strategy, costMultiplier').fetchdf().to_dict('records')
        if len(rows) != manifest['events']: raise ValueError('Event count mismatch')
        ids = sorted(rule['id'] for rule in manifest['rules'])
        for r in rows:
            if r['strategy'] not in ids or r['costMultiplier'] not in (1,1.5,2) or r['entryTimeMs'] >= manifest['developmentBoundaryMs']:
                raise ValueError('Invalid strategy/cost/development event')
            if not r['censored'] and (not math.isfinite(r['netR']) or r['labelEndTimeMs'] < r['entryTimeMs'] or r['labelEndTimeMs'] > r['entryTimeMs']+EMBARGO or r['labelEndTimeMs'] >= manifest['developmentBoundaryMs']):
                raise ValueError('Invalid or leaking event outcome')
        parquet = root/'experiments'/f'strategy-events-{identifier}.parquet'
        con.execute('COPY events TO ? (FORMAT PARQUET, COMPRESSION ZSTD)', [str(parquet)])
        con.close()
        grouped = defaultdict(list)
        for r in rows: grouped[(r['strategy'],r['costMultiplier'])].append(r)
        folds, selected_folds, trials = windows(manifest), [], []
        optuna.logging.set_verbosity(optuna.logging.ERROR)
        for fold_index, fold in enumerate(folds):
            grid = {'strategy': ids, 'h1Policy': ['align-if-available','context-only']}
            # Exhaustive grid, rather than an opaque winner chosen on test PnL.
            study = optuna.create_study(direction='maximize', sampler=optuna.samplers.GridSampler(grid,seed=72),
                storage='sqlite:///'+str(root/'experiments'/f'optuna-{identifier}.sqlite3'),study_name=f'development-fold-{fold_index}',load_if_exists=True)
            def objective(trial):
                strategy=trial.suggest_categorical('strategy',ids)
                aligned=trial.suggest_categorical('h1Policy',grid['h1Policy'])=='align-if-available'
                ms=[metrics(purged_rows(grouped[(strategy,cost)],fold['fitFromMs'],fold['fitEndMs'],aligned)) for cost in (1,1.5,2)]
                if any(m['n']<50 for m in ms): return -1_000_000.
                return min(m['netExpectancyR'] for m in ms)
            remaining = len(ids)*2-len(study.trials)
            if remaining>0: study.optimize(objective,n_trials=remaining,n_jobs=1)
            eligible = [t for t in study.trials if t.value is not None and t.value > -1_000_000]
            best = min(eligible,key=lambda t:(-t.value,t.params['strategy'],t.params['h1Policy'])) if eligible else None
            selected={'fold':fold_index,**fold,'selectedStrategy':best.params['strategy'] if best and best.value>0 else None,'candidateStrategy':best.params['strategy'] if best else None,'selectionEligible':bool(best and best.value>0),'h1Policy':best.params['h1Policy'] if best else None,'trainingObjective':best.value if best else None,'stress':[]}
            if best:
                for cost in (1,1.5,2):
                    test=purged_rows(grouped[(best.params['strategy'],cost)],fold['testFromMs'],fold['testEndMs'],best.params['h1Policy']=='align-if-available')
                    selected['stress'].append({'costMultiplier':cost,**metrics(test)})
            selected_folds.append(selected)
            trials.extend({'fold':fold_index,'number':t.number,'parameters':t.params,'value':t.value,'state':t.state.name} for t in study.trials)
        results=[]
        names={r['id']:r for r in manifest['rules']}
        # Both H1 policies are included in the multiplicity family.
        for strategy in ids:
            for aligned in (True,False):
                stress=[]
                for cost in (1,1.5,2):
                    test=[r for f in folds for r in purged_rows(grouped[(strategy,cost)],f['testFromMs'],f['testEndMs'],aligned)]
                    stress.append({'costMultiplier':cost,**metrics(test)})
                    if cost==1: evidence=block_evidence([r['netR'] for r in test])
                results.append({'id':strategy,'name':names[strategy]['name'],'family':names[strategy]['family'],'h1Policy':'align-if-available' if aligned else 'context-only','status':'research', 'stress':stress,'evidence':evidence})
        adjusted=holm_adjust([r['evidence']['pValue'] for r in results])
        for result,pvalue in zip(results,adjusted): result['evidence']['holmPValue']=pvalue
        report={'schemaVersion':1,'kind':'independent-strategy-lab','generatedAt':utc_now(),'id':identifier,'symbol':manifest['symbol'],'source':manifest['source'],'synthetic':manifest['synthetic'],
            'sourceSha256':manifest['sourceSha256'],'eventsSha256':digest.hexdigest(),'events':len(rows),'strategies':len(ids),'policyVariants':len(results),'folds':selected_folds,'results':results,
            'optimizer':{'name':'Optuna','version':optuna.__version__,'sampler':'GridSampler','trials':len(trials),'objective':'worst training net expectancy across cost multipliers','testUsedForSelection':False},
            'policy':{'scope':'original-development-half-only','usesCalibration':False,'usesFinalTest':False,'promotesPaper':False,'empiricalRatesAreConfidence':False,'embargoMs':EMBARGO,'costs':manifest['baseCost'],'stopAndTarget':'immutable, stop-first-same-OHLC','multipleTesting':'Holm over all strategy/H1 variants','uncertainty':'circular eight-trade block bootstrap; historical only'},
            'fromMs':manifest['fromMs'],'throughMs':manifest['throughMs'],'developmentBoundaryMs':manifest['developmentBoundaryMs']}
        atomic_json(root/'experiments'/f'strategy-lab-{identifier}.json',report)
        atomic_json(root/'experiments'/f'strategy-trials-{identifier}.json',{'id':identifier,'trials':trials})
        return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();source=parser.add_mutually_exclusive_group(required=True);source.add_argument('--events',type=Path);source.add_argument('--dataset',type=Path);parser.add_argument('--root',type=Path,default=DEFAULT_ROOT)
    args=parser.parse_args();events=args.events or build_events(args.dataset,args.root);report=run(events,args.root)
    print(json.dumps({k:report[k] for k in ('id','strategies','events','optimizer','fromMs','throughMs')}))
