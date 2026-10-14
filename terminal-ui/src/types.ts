export type Side='BUY'|'SELL'|'HOLD';
export type AnyRecord=Record<string,any>;
export interface Bar {time:string;open:number;high:number;low:number;close:number;volume?:number|null;closed?:boolean;}
export interface Market extends AnyRecord {symbol:string;bars:Bar[];chartHistory?:Bar[];currentBar?:Bar|null;decision:AnyRecord;feed:AnyRecord;quote?:AnyRecord|null;}
export interface State extends AnyRecord {radar:Market[];profile:AnyRecord;account:AnyRecord;positions:AnyRecord[];strategyCatalog:AnyRecord[];}
export interface DeviceBridge {deviceApi:(url:string,value?:unknown)=>Promise<any>;DeviceStateStream:new()=>{addEventListener:(name:string,listener:(event:{data:string})=>void)=>void;close:()=>void;onerror?:()=>void};}
export interface TradeDisplay {side:Side;percent:number|null;label:string;candidate:string|null;reason:string;executable:boolean;}
