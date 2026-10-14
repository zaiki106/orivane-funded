import {useEffect,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {CandlestickChart,BarChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,AxisPointerComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import type {Bar,Market} from './types';
import {price,stamp} from './presentation';
echarts.use([CandlestickChart,BarChart,GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,AxisPointerComponent,CanvasRenderer]);
export default function Chart({market,period}:{market:Market|undefined;period:number}){
 const host=useRef<HTMLDivElement>(null),chart=useRef<ReturnType<typeof echarts.init>|null>(null),[count,setCount]=useState(0),[error,setError]=useState('');
 useEffect(()=>{if(!host.current)return;const c=echarts.init(host.current,undefined,{renderer:'canvas'});chart.current=c;const resize=new ResizeObserver(()=>c.resize());resize.observe(host.current);return()=>{resize.disconnect();c.dispose();chart.current=null;};},[]);
 const fingerprint=JSON.stringify([market?.symbol,market?.chartHistory??market?.bars,market?.currentBar,period,market?.decision.entry,market?.decision.stop,market?.decision.target]);
 useEffect(()=>{let stopped=false;async function update(){try{
  const modulePath='/core/chart-timeframes.mjs',module=await import(/* @vite-ignore */ modulePath);
  const original=[...(market?.chartHistory??market?.bars??[])];if(market?.currentBar)original.push({...market.currentBar,closed:false});
  const bars:Bar[]=module.aggregateChartBars(original,period);if(stopped)return;setCount(bars.length);setError('');
  const d=market?.decision??{},accepted=(d.side==='BUY'||d.side==='SELL')&&d.confidence?.kind==='tp_before_sl_probability';
  const line=accepted?[['Entrée',d.entry,'#A8AEBE'],['Stop',d.stop,'#F57C86'],['Objectif',d.target,'#69D6B4']].filter((v)=>Number.isFinite(v[1])).map(([name,yAxis,color])=>({name,yAxis,lineStyle:{color,width:1,type:'dashed'},label:{formatter:String(name),color}})):[];
  chart.current?.setOption({animation:false,backgroundColor:'transparent',textStyle:{fontFamily:'Inter, -apple-system, BlinkMacSystemFont, sans-serif'},grid:[{left:8,right:72,top:25,bottom:90},{left:8,right:72,top:'82%',bottom:45}],
   tooltip:{trigger:'axis',confine:true,backgroundColor:'#1C2029',borderColor:'#343B4D',textStyle:{color:'#EEF1F9',fontSize:12},formatter:(params:any)=>{const row=Array.isArray(params)?params.find(p=>p.seriesType==='candlestick'):params,b=bars[row?.dataIndex];return b?`${stamp(b.time)}<br/>O ${price(b.open,market?.symbol??'')} · H ${price(b.high,market?.symbol??'')}<br/>B ${price(b.low,market?.symbol??'')} · C ${price(b.close,market?.symbol??'')}`:'';}},
   axisPointer:{link:[{xAxisIndex:'all'}],label:{backgroundColor:'#3478FF'}},
   xAxis:[0,1].map(i=>({type:'category',data:bars.map(b=>b.time),gridIndex:i,boundaryGap:true,axisLine:{show:false},axisTick:{show:false},axisLabel:{show:i===0,color:'#70798D',fontSize:11,formatter:(s:string)=>stamp(s,true).slice(0,5)},splitLine:{show:false},axisPointer:{label:{formatter:(v:any)=>stamp(v.value)}}})),
   yAxis:[{scale:true,position:'right',splitNumber:5,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#8790A3',fontSize:11,formatter:(v:number)=>price(v,market?.symbol??'')},splitLine:{lineStyle:{color:'#1B202B'}}},{scale:true,gridIndex:1,axisLine:{show:false},axisTick:{show:false},axisLabel:{show:false},splitLine:{show:false}}],
   dataZoom:[{type:'inside',xAxisIndex:[0,1],start:Math.max(0,100-58/Math.max(bars.length,1)*100),end:100,zoomOnMouseWheel:true,moveOnMouseMove:true},{type:'slider',xAxisIndex:[0,1],bottom:8,height:15,showDetail:false,borderColor:'transparent',backgroundColor:'#121722',fillerColor:'rgba(52,120,255,.13)',handleStyle:{color:'#526488',borderColor:'transparent'},dataBackground:{lineStyle:{color:'#384B6D'},areaStyle:{color:'#263651'}}}],
   series:[{type:'candlestick',name:market?.symbol,data:bars.map(b=>[b.open,b.close,b.low,b.high]),itemStyle:{color:'#65C8AD',color0:'#D46F7F',borderColor:'#65C8AD',borderColor0:'#D46F7F'},barMaxWidth:9,markLine:{silent:true,symbol:'none',data:line}},{type:'bar',xAxisIndex:1,yAxisIndex:1,data:bars.map(b=>({value:Number.isFinite(b.volume)?b.volume:null,itemStyle:{color:b.close>=b.open?'rgba(101,200,173,.22)':'rgba(212,111,127,.22)'}})),barMaxWidth:9}]},true);
 }catch{if(!stopped)setError('Graphique indisponible');}}update();return()=>{stopped=true;};},[fingerprint]);
 return <div className="chart-stage"><div ref={host} className="chart-canvas" aria-label={`Graphique en bougies ${market?.symbol??''} ${period} minutes — ${count} observations`}/>{(!count||error)&&<div className="chart-empty"><span className="chart-empty-icon">⌁</span><strong>{error||'Connexion à l’historique'}</strong><span>Les bougies apparaissent à réception du fournisseur.</span></div>}<span className="chart-watermark">orivane</span></div>;
}
