import dns from 'node:dns/promises';
import net from 'node:net';
import { InputError, uid } from '../core/project';
import type { Source } from '../core/types';

function privateIp(ip:string){
  if(ip.includes(':')) return ip==='::'||ip==='::1'||/^(fc|fd|fe[89ab])/i.test(ip)||ip.toLowerCase().includes('ffff:');
  const a=ip.split('.').map(Number);return a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===100&&a[1]>=64&&a[1]<=127);
}
export async function publicUrl(raw:string){
  let u:URL;try{u=new URL(raw);}catch{throw new InputError('请输入完整的公开网页链接');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw new InputError('仅支持公开 HTTP/HTTPS 网页');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost'))throw new InputError('不能抓取本机或内网地址');
  const addresses=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>privateIp(a.address)))throw new InputError('不能抓取本机或内网地址');return u;
}
function decode(text:string){return text.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));}
export async function importSource(raw:string):Promise<Source>{
  let u=await publicUrl(raw);let response:Response;
  for(let i=0;;i++){
    response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'miyo_AI_news/0.1 public-source-reader','Accept':'text/html,text/plain'}});
    if(response.status>=300&&response.status<400){if(i>=4)throw new InputError('网页重定向过多');const next=response.headers.get('location');if(!next)throw new InputError('网页重定向缺少目标');await response.body?.cancel();u=await publicUrl(new URL(next,u).href);continue;}break;
  }
  if(!response.ok)throw new InputError(`网页读取失败（${response.status}），可以复制原文粘贴导入`);
  const type=response.headers.get('content-type')||'';if(!/text\/html|text\/plain|application\/xhtml/.test(type))throw new InputError('此链接不是可读取的文字网页');
  const reader=response.body?.getReader();if(!reader)throw new InputError('网页正文为空');let length=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2_000_000){await reader.cancel();throw new InputError('网页超过 2MB，请粘贴需要的原文');}chunks.push(value);}
  const html=Buffer.concat(chunks).toString('utf8');
  const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||u.hostname).replace(/\s+/g,' ').trim();
  const cleaned=decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|div|article|h[1-6]|li|br)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(cleaned.length<20)throw new InputError('网页可能需要登录或由脚本加载，请复制可见原文导入');
  if(cleaned.length>60000)throw new InputError('正文超过 60000 字，请复制需要的部分导入');
  return {id:uid(),title:title.slice(0,250),url:u.href,publisher:u.hostname,date:'',note:'从公开网页提取文字，发布日期与事实待人工核对。',text:cleaned,status:'unverified'};
}
