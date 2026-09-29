/* Bold, highly visible waveform renderer for the Messiah Tour practice mixer. */
(function(){
  'use strict';

  function hash(s){
    var h=2166136261;
    for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
    return h>>>0;
  }
  function rand(seed,n){
    var x=Math.sin((seed+n*97.13)*12.9898)*43758.5453;
    return x-Math.floor(x);
  }
  function fit(canvas){
    var dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
    var r=canvas.getBoundingClientRect();
    var w=Math.max(120,Math.round(r.width*dpr));
    var h=Math.max(36,Math.round(r.height*dpr));
    if(canvas.width!==w) canvas.width=w;
    if(canvas.height!==h) canvas.height=h;
    return {w:w,h:h,dpr:dpr};
  }
  function progress(){
    var s=document.getElementById('scrub')||document.getElementById('mt-float-scrub');
    return s?Math.max(0,Math.min(1,(+s.value||0)/1000)):0;
  }
  function draw(canvas,key,isFloat){
    if(!canvas)return;
    var box=fit(canvas),w=box.w,h=box.h,ctx=canvas.getContext('2d');
    if(!ctx)return;
    var seed=hash(key||'messiah');
    var bars=Math.max(48,Math.floor(w/(isFloat?5.5:6.5)));
    var gap=Math.max(1,Math.round(box.dpr*1.3));
    var bw=Math.max(2,(w-gap*(bars-1))/bars);
    var mid=h/2;
    var p=progress();
    var playX=p*w;
    var silent=canvas.closest&&canvas.closest('.trk.silent');

    ctx.clearRect(0,0,w,h);

    // Subtle center guide so the waveform reads like a DAW track.
    ctx.globalAlpha=silent?.28:.22;
    ctx.fillStyle=isFloat?'#ffd0da':'#b0122c';
    ctx.fillRect(0,Math.round(mid),w,Math.max(1,box.dpr));

    for(var i=0;i<bars;i++){
      var x=i*(bw+gap);
      var r1=rand(seed,i), r2=rand(seed+13,i), r3=rand(seed+71,i);
      // Deliberately compressed/loud-looking waveform: most peaks sit between 55% and 96% height.
      var shape=.56 + .30*r1 + .10*Math.sin(i*.47+seed%11) + .06*r2;
      if(i%11===0||i%17===0) shape=.94;
      shape=Math.max(.48,Math.min(.97,shape));
      var amp=shape*(h*.47);
      var top=mid-amp;
      var barH=amp*2;
      var center=(x+bw/2);
      var played=center<=playX;

      ctx.globalAlpha=silent?.22:(played?.98:.67);
      ctx.fillStyle=isFloat?(played?'#ff8ca4':'#ffd0da'):(played?'#8f0d23':'#c92a45');
      var radius=Math.min(bw/2,box.dpr*2.2);
      if(ctx.roundRect){
        ctx.beginPath();ctx.roundRect(x,top,bw,barH,radius);ctx.fill();
      }else ctx.fillRect(x,top,bw,barH);

      // Add a second micro-peak to create a dense mastered-song appearance.
      if(r3>.62){
        ctx.globalAlpha=silent?.12:.22;
        ctx.fillStyle=isFloat?'#ffffff':'#5f0716';
        ctx.fillRect(x+bw*.35,top+barH*.12,Math.max(1,bw*.22),barH*.76);
      }
    }

    // Bright playhead.
    if(playX>1){
      ctx.globalAlpha=.95;
      ctx.fillStyle=isFloat?'#ffffff':'#2a070d';
      ctx.fillRect(Math.max(0,playX-box.dpr),0,Math.max(2,box.dpr*2),h);
    }
    ctx.globalAlpha=1;
  }

  function paint(){
    var song=document.querySelector('.songhead h1');
    var songName=song?song.textContent:'Messiah Tour';
    var sw=document.querySelector('.mt-song-wave');
    if(sw)draw(sw,songName+' master',false);
    document.querySelectorAll('.trk[data-i]').forEach(function(row,i){
      var c=row.querySelector('.mt-track-wave');
      var n=row.querySelector('.tname');
      if(c)draw(c,songName+' '+(n?n.textContent:i),false);
    });
    var fw=document.getElementById('mt-float-wave');
    if(fw)draw(fw,(document.getElementById('mt-float-title')||{}).textContent||songName,true);
    requestAnimationFrame(paint);
  }

  requestAnimationFrame(paint);
})();
