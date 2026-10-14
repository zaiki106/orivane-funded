import pytest
import json
from orivane_lab.publish_research import publish
from orivane_lab.strategy_lab import purged_rows, metrics, block_evidence, holm_adjust, windows


def row(start,end,value=1,aligned=True):
    return dict(entryTimeMs=start,labelEndTimeMs=end,netR=value,y=int(value>0),censored=False,status='target' if value>0 else 'stop',h1Aligned=aligned)


def test_purging_overlap_and_h1_are_applied_before_statistics():
    rows=[row(0,3),row(1,2,-1),row(4,5,aligned=False),row(6,11)]
    assert purged_rows(rows,0,10)==[rows[0]]
    assert purged_rows(rows,0,10,False)==[rows[0],rows[2]]
    assert purged_rows(rows,3,10)==[]


def test_metrics_include_loss_drawdown_and_positive_expiry_is_not_a_tp():
    rows=[row(0,1,2),row(2,3,-1),row(4,5,-2),{**row(6,7,.5),'status':'expired','y':0}]
    m=metrics(rows)
    assert m['target']==1 and m['expired']==1 and m['stop']==2
    assert m['netExpectancyR']==pytest.approx(-.125)
    assert m['maxDrawdownR']==3
    assert m['profitFactor']==pytest.approx(2.5/3)
    assert metrics([])['netExpectancyR'] is None


def test_bootstrap_and_holm_do_not_publish_confidence():
    pos=block_evidence([1.]*40,repetitions=999)
    neg=block_evidence([-1.]*40,repetitions=999)
    assert pos['interval']==[1.,1.]
    assert pos['pValue']==.001 and neg['pValue']==1
    assert holm_adjust([.01,.04,.03])==pytest.approx([.03,.06,.06])
    assert block_evidence([1.]*29)['interval'] is None


def test_all_fold_labels_and_training_are_before_final_development_boundary():
    manifest={'fromMs':0,'throughMs':1000*900000}
    folds=windows(manifest)
    for fold in folds:
        assert fold['fitEndMs']+16*900000==fold['testFromMs']
        assert fold['testEndMs']<=manifest['throughMs']
    assert len(folds)==3


def test_publish_rejects_raw_events_and_synthetic_research_before_writing(tmp_path):
    report=tmp_path/'report.json'
    report.write_text(json.dumps({'kind':'independent-strategy-development-events','synthetic':False}))
    with pytest.raises(ValueError,match='genuine aggregate'):publish(report,tmp_path/'public')
    report.write_text(json.dumps({'kind':'independent-strategy-lab','schemaVersion':1,'synthetic':True,'symbol':'BTC/USD'}))
    with pytest.raises(ValueError,match='genuine aggregate'):publish(report,tmp_path/'public')
    assert not (tmp_path/'public').exists()
