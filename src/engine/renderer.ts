import type { Game } from '../core/types';
import { createWeeklyEpisodeHtml, type Episode, type EpisodeTheme } from './legacy/weekly-episode';

export interface VideoOptions {
  game: Game;
  particles: number;
  cardScale: number;
  captionSize: number;
  fontDataUri?: string;
  imageSources?: Record<string, string>;
}

/** Theme animation is entirely a function of seek time; no timers or random calls. */
const THEME_RUNTIME = String.raw`
  function leaf(c,x,y,size,angle,color){c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=color;c.beginPath();c.moveTo(-size,0);c.quadraticCurveTo(0,-size,size,0);c.quadraticCurveTo(0,size,-size,0);c.fill();c.restore();}
  function sparkle(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.moveTo(x-r,y);c.quadraticCurveTo(x,y,x,y-r*1.7);c.quadraticCurveTo(x,y,x+r,y);c.quadraticCurveTo(x,y,x,y+r*1.7);c.quadraticCurveTo(x,y,x-r,y);c.fill();}
  function themeCount(base){return Math.ceil(base*settings.particles);}
  hooks.stars=function(t,warp){
    var game=settings.game;ctx.save();ctx.globalAlpha=Math.min(1,settings.particles);
    if(game==='genshin'){
      for(var line=0;line<7;line++){
        var y=270+line*111+Math.sin(t*.12+line)*24;
        ctx.strokeStyle=line%2?'#86b3932e':'#a9935930';ctx.lineWidth=line%2?1:1.6;
        ctx.beginPath();ctx.moveTo(-100,y+100);ctx.bezierCurveTo(450,y+180,930,y-270,2000,y-90);ctx.stroke();
      }
      stars.slice(0,themeCount(42)).forEach(function(s,i){
        var x=(s.x+t*(9+s.s*9))%2020-50,y=(s.y-t*(3+s.s)+Math.sin(t*.3+s.p)*28)%1160;
        leaf(ctx,x,y,4+s.r*3,Math.sin(t*.35+s.p)+i,i%3?'#779c6a77':'#bc9e5077');
      });
    }else if(game==='hi3'){
      var glow=ctx.createRadialGradient(1510,360,40,1510,360,640);
      glow.addColorStop(0,'#be85bd17');glow.addColorStop(.6,'#7172b315');glow.addColorStop(1,'#41456c00');ctx.fillStyle=glow;ctx.fillRect(0,0,1920,1080);
      stars.slice(0,themeCount(95)).forEach(function(s,i){
        var x=(s.x+t*(.9+s.s*1.6))%1920,y=s.y+Math.sin(t*.18+s.p)*13;
        ctx.globalAlpha=(.25+.35*(1+Math.sin(t*.7+s.p))*.5)*Math.min(1,settings.particles);
        if(i%5===0)sparkle(ctx,x,y,2+s.r,'#ead7b3');else{ctx.fillStyle=i%2?'#bec8ec':'#e4bdd8';ctx.fillRect(x,y,s.r,s.r);}
      });
      ctx.globalAlpha=.14*Math.min(1,settings.particles);ctx.strokeStyle='#cbb584';ctx.beginPath();ctx.ellipse(1510,410,355,226,-.45,0,Math.PI*2);ctx.stroke();
    }else{
      var step=Math.floor(t*12);
      for(var row=0;row<32;row++){
        var y=22+row*35;ctx.fillStyle=row%3?'#ffffff0a':'#e8f26615';ctx.fillRect(30,y,1860,1);
      }
      stars.slice(0,themeCount(50)).forEach(function(s,i){
        var x=(s.x+((step+i*7)%27)*13)%1920,y=s.y;
        ctx.fillStyle=i%3?'#f1f0df44':'#e5ed5777';ctx.fillRect(x,y,3+(i%4)*6,2+i%2);
      });
      ctx.strokeStyle='#e9ee652a';ctx.lineWidth=2;ctx.strokeRect(38,30,1844,1020);
    }
    ctx.restore();
  };
  hooks.card=function(card,t,index,highlight){
    var c=card.ctx,w=card.width,h=card.height;c.save();c.globalAlpha=Math.min(1,settings.particles);
    if(settings.game==='genshin'){
      c.strokeStyle='#63856a44';c.lineWidth=1;
      for(var line=0;line<3;line++){var y=h-20-line*6;c.beginPath();c.moveTo(22,y);c.bezierCurveTo(w*.3,y-7,w*.66,y+6,w-22,y-3);c.stroke();}
      for(var i=0;i<themeCount(6);i++){var p=(t*.026+i*.167+index*.11)%1;leaf(c,24+(w-48)*p,i%2?17:h-25,3+i%3,t*.4+i,'#72905799');}
      if(highlight){c.strokeStyle='#b5985844';c.strokeRect(10,10,w-20,h-20);}
    }else if(settings.game==='hi3'){
      c.strokeStyle='#e4c69766';c.setLineDash([2,8]);c.strokeRect(12,12,w-24,h-24);c.setLineDash([]);
      for(var j=0;j<themeCount(8);j++){var x=20+(w-40)*((j*.137+t*.018)%1),y=j%2?19:h-19;var r=1.5+Math.pow(Math.max(0,Math.sin(t+j)),3)*3;sparkle(c,x,y,r,j%2?'#e4bdd8':'#edcf96');}
      if(highlight){var y=(t*.045%1)*h;c.fillStyle='#e4cfaf15';c.fillRect(9,y,w-18,2);}
    }else{
      var step=Math.floor(t*9);c.fillStyle='#111318';
      for(var k=0;k<themeCount(18);k++){var x=14+((k*53+step*7)%(Math.max(1,w-28)));c.fillRect(x,k%2?12:h-15,2+k%4,3);}
      if(highlight){c.fillStyle='#ecf266';c.fillRect(w-46,10,30,5);c.fillStyle='#161819';c.fillRect(w-22,10,6,5);}
    }
    c.restore();
  };
  hooks.motion=function(pose,from,to,style,p,incoming,outgoing){
    if(p<=0||p>=1||(!incoming&&!outgoing))return pose;
    var b=Math.sin(Math.PI*p);
    if(settings.game==='genshin'){
      pose.y+=(incoming?-38:20)*b;pose.rotate+=(incoming?-2.2:1.4)*b;pose.turn=style==='ticket'?pose.turn*.55:0;
    }else if(settings.game==='hi3'){
      pose.y+=(incoming?28:-20)*b;pose.rotate+=(incoming?1:-1)*1.2*b;
      if(style==='classic'||style==='hologram')pose.reveal=Math.max(.05,1-b*.16);
    }else{
      var q=Math.floor(p*5)/5;pose.x=from.x+(to.x-from.x)*q;pose.y=from.y+(to.y-from.y)*q;
      pose.scale=from.scale+(to.scale-from.scale)*q;pose.rotate=(incoming?-1:1)*2*b;
      pose.turn=0;pose.blur=0;pose.reveal=1;
    }
    return pose;
  };
  hooks.transition=function(style,p,strength,chapter){
    var wave=Math.sin(Math.PI*p),game=settings.game;
    fx.save();fx.globalAlpha=wave*strength;
    if(!chapter){fx.beginPath();fx.rect(stage.left,stage.top,stage.right-stage.left,stage.bottom-stage.top);fx.clip();}
    if(game==='genshin'){
      if(chapter){
        var x=-680+2700*smooth(p),wind=fx.createLinearGradient(x,0,x+650,0);
        wind.addColorStop(0,'#cfddc600');wind.addColorStop(.24,'#edf0dbe8');wind.addColorStop(.65,'#8fb096bb');wind.addColorStop(1,'#cfddc600');
        fx.fillStyle=wind;fx.fillRect(x,0,670,1080);
      }
      fx.strokeStyle='#abc28caa';fx.lineWidth=1.5;
      for(var line=0;line<9;line++){var y=(chapter?50:stage.top+21)+line*(chapter?122:(stage.bottom-stage.top-42)/8),drift=80*Math.sin(p*Math.PI+line*.1);fx.beginPath();fx.moveTo(-80,y+drift);fx.bezierCurveTo(500,y-130,1000,y+130,2000,y-drift);fx.stroke();}
      for(var j=0;j<themeCount(15);j++)leaf(fx,(j*163+p*1200)%2070-60,(j*113+80)%1080,4+j%4,p*3+j,'#bda360bb');
    }else if(game==='hi3'){
      if(chapter){
        fx.translate(-800+3100*smooth(p),0);fx.transform(1,0,-.45,1,0,0);
        var curtain=fx.createLinearGradient(0,0,740,0);curtain.addColorStop(0,'#171e3800');curtain.addColorStop(.2,'#bd9bbfe8');curtain.addColorStop(.36,'#f0d2a2ed');curtain.addColorStop(.4,'#1e264bf5');curtain.addColorStop(1,'#20294b00');fx.fillStyle=curtain;fx.fillRect(0,-200,740,1480);
        fx.strokeStyle='#f0d5aa88';fx.lineWidth=2;fx.strokeRect(150,80,280,910);
        for(var k=0;k<themeCount(20);k++)sparkle(fx,50+k%5*93,60+Math.floor(k/5)*260,3+k%4,'#f5dab9');
      }else{
        fx.strokeStyle='#dbc49a99';fx.lineWidth=1;fx.beginPath();fx.ellipse(stage.cx,stage.cy,858,320,-.06,Math.PI*p,Math.PI*(p+1.7));fx.stroke();
        for(var s=0;s<themeCount(22);s++)sparkle(fx,70+(s*127+p*500)%1800,s%2?stage.top+18:stage.bottom-15,2+s%4,'#ead8b6');
      }
    }else{
      var step=Math.floor(p*9),top=chapter?0:stage.top,height=chapter?1080:stage.bottom-stage.top;
      for(var row=0;row<12;row++){
        var offset=((step*73+row*37)%280)-140,y=top+row*height/12;
        fx.fillStyle=(row+step)%4===0?'#e7ee67dd':(row+step)%2?'#f0eee4dd':'#111318eb';
        var width=chapter?(480+wave*1150):130;
        fx.fillRect((chapter?-680+p*2550:((p*2100)%1920))+offset,y,width,height/12-3);
        fx.fillStyle='#74d9d888';fx.fillRect(offset+(chapter?0:70),y+4,chapter?1920:120,2);
      }
      if(chapter){fx.fillStyle='#e8ef63';fx.fillRect(0,1010,1920,24);fx.fillStyle='#131619';for(var mark=0;mark<48;mark++)fx.fillRect(mark*45+step*3,1010,22,24);}
    }
    fx.restore();
  };
`;

const THEMES: Record<Game, EpisodeTheme> = {
  starrail: {
    id: 'starrail', brand: '星穹列车 · 每周公报', tagline: '版本动态 · 活动见闻 · 开拓者社区',
    emblem: '星穹列车', curtainLabel: '星穹列车 · 下一站', css: '', runtime: '',
  },
  genshin: {
    id: 'genshin', brand: '提瓦特 · 旅行手记', tagline: '风土见闻 · 冒险纪事 · 旅行者来信',
    emblem: '旅行手记', curtainLabel: '风起 · 新的一页', runtime: THEME_RUNTIME,
    css: String.raw`
      #viewport{--theme-edge:#66816c77;background:#dfe6d6;color:#30493e}
      #viewport .background{background:radial-gradient(ellipse at 83% 34%,#b6cbae66,transparent 53%),linear-gradient(125deg,#e8e9d8,#d4e0ce)}
      #viewport .background:before{background-image:repeating-radial-gradient(ellipse at 100% 0,transparent 0 72px,#79947e15 73px 74px,transparent 76px 110px);background-size:auto;mask-image:none}
      #viewport .background:after{border:23px solid #c4d3bc;border-top:8px solid #789477;opacity:.65}
      #viewport .brand-mark{border-color:#718468;border-radius:80% 0 80% 0;transform:rotate(-20deg)}
      #viewport .brand-mark:before,#viewport .brand-mark:after{background:#a79360}
      #viewport .brand b{color:#3c5644}#viewport .brand small,#viewport .period small{color:#75846c}
      #viewport .period,#viewport .chapter.active{color:#7b6b3c}
      #viewport .kicker,#viewport .scene-subtitle{color:#647e65}#viewport .chapter-index{border-color:#89967388;color:#65764d}
      #viewport .chapters{border-color:#6d896b55}#viewport .chapter{color:#82917a}#viewport .chapter.passed{color:#526d57}
      #viewport .chapter-progress,#viewport #global-progress{background:#8c995e}
      #viewport .ticket{background:linear-gradient(120deg,#f6f1dc,#ebe9d0);color:#334c3e;border:1px solid #a8b797;clip-path:polygon(0 1%,98% 0,100% 97%,1% 100%);border-radius:3px 19px 3px 12px;box-shadow:0 8px 12px #3d584b11}
      #viewport .ticket:before{content:'';position:absolute;inset:9px;border:1px solid #8ba07f3d;border-radius:2px 12px 2px 8px;pointer-events:none}
      #viewport .ticket:nth-child(2n){background:linear-gradient(125deg,#dbe5cb,#edf0db)}
      #viewport .ticket-top,#viewport .ticket-number{color:#799065}
      #viewport .ticket h2{color:#35553c}#viewport .ticket p{color:#52664b}
      #viewport .ticket-track{display:none}#viewport .event .ticket-1:after{display:none}
      #viewport .event .ticket-1{padding-right:46px}#viewport .event .ticket-number{position:static;writing-mode:horizontal-tb;font-size:18px}
      #viewport .scene-emblem{color:#718c63}#viewport .orbit{border-color:#8c9c6688;border-radius:80% 0 80% 0}
      #viewport .captions{background:#f4f0dded;border-color:#9faf8c;color:#344f3d;box-shadow:0 4px 20px #53654811}
      #viewport .source,#viewport .bottom-meta{color:#72866c;border-color:#a0b19166}#viewport .source>span,#viewport #time-label{color:#627954}
    `,
  },
  hi3: {
    id: 'hi3', brand: '女武神档案 · 星海纪事', tagline: '作战记录 · 剧情档案 · 舰长通讯',
    emblem: '档案星幕', curtainLabel: '档案解封 · 下一章', runtime: THEME_RUNTIME,
    css: String.raw`
      #viewport{--theme-edge:#e4caa477;background:#10162b;color:#ece5d5}
      #viewport .background{background:radial-gradient(ellipse at 80% 37%,#69517833,transparent 53%),linear-gradient(115deg,#0f152a,#202a43)}
      #viewport .background:before{background-image:linear-gradient(90deg,transparent 49.9%,#d5bd9022 50%,transparent 50.1%),repeating-linear-gradient(0deg,transparent 0 119px,#e1cca80b 120px);background-size:100% 100%;mask-image:none}
      #viewport .background:after{border:25px solid #101426;outline:1px solid #d9b78266;outline-offset:-39px}
      #viewport .brand-mark{border:1px solid #d1b38c;transform:rotate(0);border-radius:50%}
      #viewport .brand-mark:before,#viewport .brand-mark:after{background:#d7c2a0}
      #viewport .brand b{color:#e7dac4}#viewport .brand small,#viewport .period small{color:#9a9dbb}
      #viewport .period,#viewport .chapter.active{color:#d7b88c}
      #viewport .kicker,#viewport .scene-subtitle{color:#b3adc5}#viewport .chapter-index{color:#dcc49b;border-color:#ac946966}
      #viewport .chapters{border-color:#bfa37c44}#viewport .chapter{color:#868ea8}#viewport .chapter.passed{color:#c0aeca}
      #viewport .chapter-progress,#viewport #global-progress{background:#d5b889}
      #viewport .ticket{background:linear-gradient(115deg,#29314b,#192039);color:#e8ddca;border:1px solid #bca58199;clip-path:polygon(0 16px,20px 0,calc(100% - 20px) 0,100% 16px,100% 100%,0 100%);border-radius:0}
      #viewport .ticket:nth-child(2n){background:linear-gradient(120deg,#342e47,#242840)}
      #viewport .ticket:before{content:'';position:absolute;top:0;left:34px;right:34px;height:5px;background:linear-gradient(90deg,#b79b72 20%,transparent 20%);opacity:.7}
      #viewport .ticket-top,#viewport .ticket-number{color:#bda789;letter-spacing:3px}
      #viewport .ticket h2{color:#eddfc5}#viewport .ticket p{color:#bebbd0}
      #viewport .ticket-track{border-top:1px solid #b8a58655;height:1px}#viewport .ticket-track i,#viewport .ticket-track b{display:none}
      #viewport .event .ticket-1:after{display:none}#viewport .event .ticket-1{padding-right:46px}#viewport .event .ticket-number{position:static;writing-mode:horizontal-tb;font-size:18px}
      #viewport .scene-emblem{color:#d8c198}#viewport .orbit{border-color:#d5b88e99}
      #viewport .captions{background:#141a2fee;border-color:#b9a17c66;color:#ece3d2}
      #viewport .source,#viewport .bottom-meta{color:#909ab4;border-color:#a58d7144}#viewport .source>span,#viewport #time-label{color:#bcab91}
    `,
  },
  zzz: {
    id: 'zzz', brand: '新艾利都 · 录像店频道', tagline: '街区情报 / 空洞速递 / 绳匠留言',
    emblem: 'ON AIR', curtainLabel: '频道切换 / PLAY', runtime: THEME_RUNTIME,
    css: String.raw`
      #viewport{--theme-edge:#f2f05caa;background:#141617;color:#f3f0e5}
      #viewport .background{background:radial-gradient(circle at 86% 25%,#ddea6117,transparent 36%),linear-gradient(135deg,#101213,#222626)}
      #viewport .background:before{background-image:radial-gradient(#e1e6b51a 1px,transparent 1.2px);background-size:9px 9px;mask-image:none}
      #viewport .background:after{border:18px solid #080a0b;opacity:1}
      #viewport .brand-mark{border:6px solid #e5ed62;transform:rotate(-8deg);border-radius:0}
      #viewport .brand-mark:before,#viewport .brand-mark:after{background:#111;transform:rotate(45deg)}
      #viewport .brand b{color:#ecf168;letter-spacing:1px}#viewport .brand small,#viewport .period small{color:#a3aba3;letter-spacing:2px}
      #viewport .period,#viewport .chapter.active{color:#e5ec63}
      #viewport .kicker{color:#e6ed65;font-weight:800}#viewport .scene-subtitle{color:#b5bcb5}#viewport .chapter-index{background:#e6ed65;color:#181b18;border:0}
      #viewport .chapters{border-color:#e9ed6266}#viewport .chapter{color:#9baba4;font-weight:700}#viewport .chapter.passed{color:#dad9cb}
      #viewport .chapter:before{border:0;background:currentColor;transform:rotate(0);width:7px;height:7px}
      #viewport .chapter-progress,#viewport #global-progress{background:#e6ee61}
      #viewport .ticket{background:#e8e6dc;color:#101516;border:3px solid #101415;clip-path:polygon(1% 0,100% 1%,99% 99%,0 100%);border-radius:0;box-shadow:8px 8px 0 #080b0b}
      #viewport .ticket:nth-child(2n){background:#dce760}#viewport .ticket:nth-child(3n){background:#f0ece2}
      #viewport .ticket:before{content:'';position:absolute;left:10px;top:0;width:70px;height:8px;background:repeating-linear-gradient(90deg,#111 0 4px,transparent 4px 7px)}
      #viewport .ticket-top,#viewport .ticket-number{color:#3d493c;font-weight:800;letter-spacing:1px}
      #viewport .ticket h2{color:#111615;font-weight:900;letter-spacing:-.5px}#viewport .ticket p{color:#354137}
      #viewport .ticket-track{display:none}#viewport .event .ticket-1:after{display:none}#viewport .event .ticket-1{padding-right:46px}#viewport .event .ticket-number{position:static;writing-mode:horizontal-tb;font-size:18px}
      #viewport .scene-emblem{color:#e4ed63}#viewport .scene-emblem span{font-weight:900;letter-spacing:-2px}#viewport .orbit{border-color:#dee85c88;border-radius:0;width:125px;height:75px}
      #viewport .captions{background:#e4eb65;color:#151a14;border:3px solid #111;box-shadow:6px 6px 0 #070a09;border-radius:0}
      #viewport.center-focus .captions{box-shadow:4px 1px 0 #070a09}
      #viewport .source,#viewport .bottom-meta{color:#a4b19e;border-color:#d9e16844}#viewport .source>span,#viewport #time-label{color:#dce675}
    `,
  },
};

/** Shared preview/export entry. Star Rail continues using the original animation path. */
export function createVideoHtml(episode: Episode, options: VideoOptions): string {
  const theme = THEMES[options.game];
  if (!theme) throw new Error(`Unsupported game: ${String(options.game)}`);
  return createWeeklyEpisodeHtml(episode, { ...options, theme });
}
