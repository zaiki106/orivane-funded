"""Prepare only the aggregate report for the website; never deploy or promote models."""
import argparse
import hashlib
import json
from pathlib import Path
from .storage import atomic_json


def publish(report_path:Path, public_root:Path):
    report=json.loads(report_path.read_text(encoding='utf-8'))
    policy=report.get('policy',{})
    if report.get('kind')!='independent-strategy-lab' or report.get('schemaVersion')!=1 or report.get('synthetic') is not False or report.get('symbol')!='BTC/USD' or policy.get('usesFinalTest') is not False or policy.get('promotesPaper') is not False or policy.get('empiricalRatesAreConfidence') is not False:
        raise ValueError('Only genuine aggregate BTC development research can be exported')
    forbidden={'examples','bars','entryTimeMs','labelEndTimeMs','entry','stopPrice','targetPrice','positions','token','password','apiKey'}
    def inspect(value):
        if isinstance(value,dict):
            if forbidden.intersection(value): raise ValueError('Raw/private fields cannot be published')
            for item in value.values():inspect(item)
        elif isinstance(value,list):
            for item in value:inspect(item)
    inspect(report)
    text=json.dumps(report,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
    if len(text)>2_000_000:raise ValueError('Aggregate report exceeds mobile size limit')
    root=public_root.resolve()
    platform_path=root/'platform.json'
    platform=json.loads(platform_path.read_text(encoding='utf-8'))
    if platform.get('version')!='wallstreet12':raise ValueError('Incompatible platform protocol')
    target=root/'reports/strategy-lab.json';target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_suffix('.json.tmp');temporary.write_bytes(text);temporary.replace(target)
    descriptor={'name':'BTC · stratégies indépendantes','kind':'strategy-lab','symbol':report['symbol'],'version':report['id'],'generatedAt':report['generatedAt'],'url':'/reports/strategy-lab.json','sha256':hashlib.sha256(text).hexdigest()}
    platform['reports']=[r for r in platform.get('reports',[]) if r.get('kind')!='strategy-lab']+[descriptor]
    atomic_json(platform_path,platform)
    return descriptor


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--report',required=True,type=Path);parser.add_argument('--public',required=True,type=Path)
    args=parser.parse_args();print(json.dumps(publish(args.report,args.public)))
