export type StarRailTransition = 'classic' | 'warp' | 'orbit' | 'ticket' | 'hologram';
export type StarRailSceneTransition = StarRailTransition | 'ticket-wipe';

/** Deterministic motion helpers, embedded in the standalone episode player. */
export const STAR_RAIL_TRANSITION_RUNTIME = String.raw`
  var focusFx=document.getElementById('focus-transition');
  var fx=focusFx.getContext('2d');
  function motionStyle(scene,index,cueIndex){
    var cue=scene.focusCues&&scene.focusCues[cueIndex];
    var style=(cueIndex>0&&cue&&cue.transition)||scene.transition||'classic';
    return style==='ticket-wipe'?'classic':style;
  }
  function motionDuration(style){return {classic:.62,warp:.68,orbit:.76,ticket:.72,hologram:.7}[style]||.62;}
  function focusMotion(from,to,style,p,incoming,outgoing){
    var m=smooth(p),b=Math.sin(Math.PI*p);
    var pose={x:from.x+(to.x-from.x)*m,y:from.y+(to.y-from.y)*m,
      scale:from.scale+(to.scale-from.scale)*m,opacity:from.opacity+(to.opacity-from.opacity)*m,
      rotate:from.rotate+(to.rotate-from.rotate)*m,turn:0,blur:0,reveal:1};
    // Preserve the original carousel: smooth translation, scale, opacity and rotation only.
    if(style==='classic'||p<=0||p>=1||(!incoming&&!outgoing))return pose;
    if(style==='warp'){
      var drive=ease(p);pose.x=from.x+(to.x-from.x)*drive;
      pose.scale*=1-.055*b;pose.blur=1.2*b;
    }else if(style==='orbit'){
      pose.y+=(incoming?-1:1)*48*b;
      pose.x+=(incoming?1:-1)*55*b;
      pose.scale*=1-.16*b;pose.rotate+=(incoming?-1:1)*2.4*b;
    }else if(style==='ticket'){
      pose.turn=(incoming?1:-1)*68*b;pose.scale*=1-.16*b;
      pose.rotate*=1-b;
    }else if(style==='hologram'){
      // The old card closes to a slit, then the new card unfolds at the same center.
      if(outgoing){
        var exit=smooth(clamp((p-.46)/.54,0,1));
        pose.x=to.x*exit;pose.y=to.y*exit;
        pose.scale=from.scale+(to.scale-from.scale)*exit;
        pose.opacity=from.opacity*(1-smooth(clamp(p/.48,0,1)))+to.opacity*exit;
        pose.reveal=p<.46?1-smooth(p/.46):exit;
        pose.rotate=to.rotate*exit;
      }else if(incoming){
        var gather=smooth(clamp(p/.26,0,1)),reveal=smooth(clamp((p-.24)/.48,0,1));
        pose.x=from.x*(1-gather);pose.y=from.y*(1-gather);
        pose.scale=from.scale+(to.scale-from.scale)*gather;
        pose.opacity=from.opacity*(1-gather)+to.opacity*reveal;
        pose.reveal=(1-gather)+reveal;pose.rotate=from.rotate*(1-gather);
      }
    }
    return pose;
  }
  function diamond(c,x,y,r){c.beginPath();c.moveTo(x,y-r);c.lineTo(x+r,y);c.lineTo(x,y+r);c.lineTo(x-r,y);c.closePath();c.fill();}
  function drawTransition(style,p,strength,chapter){
    if(hooks.transition){if(!reduced&&p>0&&p<1)hooks.transition(style,p,strength,chapter);return;}
    if(style==='classic'||style==='ticket-wipe'||reduced||p<=0||p>=1)return;
    var pulse=Math.sin(Math.PI*p)*strength;
    fx.save();fx.beginPath();fx.rect(stage.left,stage.top,stage.right-stage.left,stage.bottom-stage.top);fx.clip();
    fx.globalAlpha=pulse;fx.lineWidth=1.2;
    if(style==='warp'){
      for(var i=0;i<18;i++){
        var x=((i*173+p*1600)%1880)+20,y=i%2?stage.bottom-14-(i%4)*6:stage.top+14+(i%4)*6;
        var gradient=fx.createLinearGradient(x-180,y,x,y);
        gradient.addColorStop(0,'#8ad9f000');gradient.addColorStop(1,i%4?'#99e5ffbb':'#f4d392cc');
        fx.strokeStyle=gradient;fx.beginPath();fx.moveTo(x-180,y);fx.lineTo(x,y);fx.stroke();
        fx.fillStyle='#d4f5ff';diamond(fx,x,y,2);
      }
    }else if(style==='orbit'){
      for(var ring=0;ring<2;ring++){
        fx.strokeStyle=ring?'#d8bb7866':'#8de2f780';
        fx.beginPath();fx.ellipse(stage.cx,stage.cy,858-ring*24,332-ring*17,0,Math.PI*(.12+p*.4),Math.PI*(1.85+p*.4));fx.stroke();
        for(var j=0;j<5;j++){
          var a=j*Math.PI*.4+p*Math.PI*(ring?-1:1),x=stage.cx+Math.cos(a)*(858-ring*24),y=stage.cy+Math.sin(a)*(332-ring*17);
          // Keep stars and bright marks on the outer rim, away from card text.
          if(Math.abs(x-stage.cx)>720||Math.abs(y-stage.cy)>300){fx.fillStyle=ring?'#f4d59a':'#a1e9ff';diamond(fx,x,y,j===0?4:2);}
        }
      }
    }else if(style==='ticket'){
      var spread=110+750*smooth(p);
      fx.strokeStyle='#efd09399';fx.setLineDash([3,9]);
      [960-spread,960+spread].forEach(function(x){fx.beginPath();fx.moveTo(x,stage.top+24);fx.lineTo(x,stage.bottom-24);fx.stroke();});fx.setLineDash([]);
      fx.strokeStyle='#eaca85bb';fx.beginPath();fx.moveTo(stage.cx-spread,stage.bottom-14);fx.lineTo(stage.cx+spread,stage.bottom-14);fx.stroke();
      fx.fillStyle='#f1d59b';diamond(fx,stage.cx-spread,stage.bottom-14,5);diamond(fx,stage.cx+spread,stage.bottom-14,5);
    }else if(style==='hologram'){
      var half=860*smooth(clamp((p-.24)/.48,0,1));
      fx.strokeStyle='#9eeaff66';
      [960-half,960+half].forEach(function(x){
        fx.beginPath();fx.moveTo(x,stage.top+22);fx.lineTo(x,stage.bottom-22);fx.stroke();
        fx.fillStyle='#b8f3ff99';
        for(var y=stage.top+26;y<stage.bottom-21;y+=26){fx.fillRect(x-4,y,8,1);}
      });
      for(var n=0;n<36;n++){
        var px=100+n*49,py=n%2?stage.bottom-14:stage.top+14;
        fx.fillStyle=n%3?'#8cdcf388':'#dec48799';fx.fillRect(px,py,2+(n%2),2);
      }
    }
    fx.restore();
  }
`;
