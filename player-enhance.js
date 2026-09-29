/* Persistent practice player + live waveform visualizers. Loaded before app.js. */
(function(){
  'use strict';

  var NativeAudio = window.Audio;
  var nativePause = HTMLMediaElement.prototype.pause;
  var nativeLoad = HTMLMediaElement.prototype.load;
  var nativeRemove = Element.prototype.removeAttribute;
  var AC = window.AudioContext || window.webkitAudioContext;
  var nativeClose = AC && AC.prototype.close;
  var nativeCreateMES = AC && AC.prototype.createMediaElementSource;

  var allAudios=[];
  var analyserByAudio=new WeakMap();
  var ctxByAudio=new WeakMap();
  var currentBank=[];
  var floatingBank=[];
  var preserveSet=new Set();
  var preserveDestroy=false;
  var floatingTitle='';
  var floatingWasPlaying=false;
  var floatRaf=0;
  var syncTimer=0;
  var lastRowCount=0;

  window.Audio=function(src){
    var el = new NativeAudio(src);
    allAudios.push(el);
    return el;
  };
  window.Audio.prototype = NativeAudio.prototype;

  if(AC && nativeCreateMES){
    AC.prototype.createMediaElementSource=function(el){
      var src=nativeCreateMES.call(this,el);
      try{
        var an=this.createAnalyser(); an.fftSize=256; an.smoothingTimeConstant=.72;
        var silent=this.createGain(); silent.gain.value=0;
        src.connect(an); an.connect(silent); silent.connect(this.destination);
        analyserByAudio.set(el,an); ctxByAudio.set(el,this);
      }catch(e){}
      return src;
    };
    AC.prototype.close=function(){
      if(preserveDestroy) return Promise.resolve();
      return nativeClose.call(this);
    };
  }

  HTMLMediaElement.prototype.pause=function(){
    if(preserveDestroy && preserveSet.has(this)) return;
    return nativePause.call(this);
  };
  HTMLMediaElement.prototype.load=function(){
    if(preserveDestroy && preserveSet.has(this)) return;
    return nativeLoad.call(this);
  };
  Element.prototype.removeAttribute=function(name){
    if(preserveDestroy && name==='src' && preserveSet.has(this)) return;
    return nativeRemove.call(this,name);
  };

  function fmt(t){
    if(!isFinite(t)||t<0)t=0;
    var m=Math.floor(t/60),s=Math.floor(t%60);
    return m+':'+(s<10?'0':'')+s;
  }
  function bankMaster(bank){
    var best=null,d=-1;
    bank.forEach(function(el){var x=el.duration||0;if(x>d){d=x;best=el;}});
    return best||bank[0]||null;
  }
  function bankNow(bank){var m=bankMaster(bank);return m?m.currentTime||0:0;}
  function bankDuration(bank){var m=bankMaster(bank);return m?m.duration||0:0;}
  function bankPlaying(bank){return bank.some(function(el){return !el.paused&&!el.ended;});}
  function setBankTime(bank,t){bank.forEach(function(el){try{el.currentTime=Math.min(t,el.duration||t);}catch(e){}});}
  function pauseBank(bank){bank.forEach(function(el){try{nativePause.call(el);}catch(e){}}); updateFloat();}
  function playBank(bank){
    if(!bank.length)return;
    var t=bankNow(bank),d=bankDuration(bank); if(d&&t>=d-.2){t=0;setBankTime(bank,0);}
    bank.forEach(function(el){try{el.currentTime=t;el.play().catch(function(){});}catch(e){}});
    ensureSync(); updateFloat(); setMediaSession();
  }
  function stopBank(bank){
    var contexts=new Set();
    bank.forEach(function(el){
      try{nativePause.call(el);nativeRemove.call(el,'src');nativeLoad.call(el);}catch(e){}
      var c=ctxByAudio.get(el); if(c)contexts.add(c);
    });
    contexts.forEach(function(c){try{nativeClose.call(c);}catch(e){}});
  }
  function ensureSync(){
    if(syncTimer)return;
    syncTimer=setInterval(function(){
      if(!floatingBank.length||!bankPlaying(floatingBank))return;
      var m=bankMaster(floatingBank); if(!m)return;
      var now=m.currentTime;
      floatingBank.forEach(function(el){
        if(el===m||el.ended||el.paused)return;
        if(Math.abs((el.currentTime||0)-now)>.08){try{el.currentTime=now;}catch(e){}}
      });
    },700);
  }

  function snapshotCurrent(){
    var rows=document.querySelectorAll('.trk[data-i]');
    if(!rows.length||!currentBank.length)return false;
    floatingTitle=(document.querySelector('.songhead h1')||{}).textContent||'Practice mixer';
    floatingBank=currentBank.slice();
    floatingWasPlaying=bankPlaying(floatingBank);
    preserveSet=new Set(floatingBank);
    rows.forEach(function(row,i){
      var el=floatingBank[i]; if(!el)return;
      var vol=row.querySelector('[data-vol]');
      var mute=row.querySelector('[data-mute]');
      var solo=row.querySelector('[data-solo]');
      if(vol)el.volume=parseFloat(vol.value||'1');
      if(mute&&mute.getAttribute('aria-pressed')==='true')el.muted=true;
      if(solo&&solo.getAttribute('aria-pressed')==='true')el.muted=false;
    });
    return true;
  }

  var nativeAdd=window.addEventListener.bind(window);
  window.addEventListener=function(type,listener,opts){
    if(type==='hashchange' && typeof listener==='function'){
      return nativeAdd(type,function(ev){
        var had=snapshotCurrent();
        if(had)preserveDestroy=true;
        try{listener.call(window,ev);}finally{
          preserveDestroy=false;
          if(had){showFloat(); if(floatingWasPlaying) ensureSync();}
        }
      },opts);
    }
    return nativeAdd(type,listener,opts);
  };

  function ensureFloat(){
    var p=document.getElementById('mt-float-player');
    if(p)return p;
    p=document.createElement('section'); p.id='mt-float-player'; p.hidden=true;
    p.innerHTML='<div class="mt-float-main"><button class="mt-float-play" aria-label="Play">▶</button><div class="mt-float-info"><strong id="mt-float-title">Practice mixer</strong><span id="mt-float-clock">0:00 / 0:00</span></div><canvas id="mt-float-wave" width="420" height="54" aria-label="Audio waveform"></canvas><input id="mt-float-scrub" type="range" min="0" max="1000" value="0" aria-label="Position"><a id="mt-float-back" href="#/">Open mixer</a><button id="mt-float-close" aria-label="Close player">×</button></div>';
    document.body.appendChild(p);
    p.querySelector('.mt-float-play').onclick=function(){bankPlaying(floatingBank)?pauseBank(floatingBank):playBank(floatingBank);};
    p.querySelector('#mt-float-close').onclick=function(){pauseBank(floatingBank);stopBank(floatingBank);floatingBank=[];preserveSet.clear();p.hidden=true;};
    var sc=p.querySelector('#mt-float-scrub');
    sc.oninput=function(){var d=bankDuration(floatingBank);setBankTime(floatingBank,(+sc.value/1000)*d);updateFloat();};
    return p;
  }
  function showFloat(){
    if(!floatingBank.length)return;
    var p=ensureFloat(); p.hidden=false;
    p.querySelector('#mt-float-title').textContent=floatingTitle;
    p.querySelector('#mt-float-back').href=location.hash.indexOf('#/song/')===0?location.hash:'#/';
    updateFloat(); drawFloatLoop(); setMediaSession();
  }
  function updateFloat(){
    var p=document.getElementById('mt-float-player'); if(!p||!floatingBank.length)return;
    p.querySelector('.mt-float-play').textContent=bankPlaying(floatingBank)?'❚❚':'▶';
    p.querySelector('#mt-float-clock').textContent=fmt(bankNow(floatingBank))+' / '+fmt(bankDuration(floatingBank));
    var d=bankDuration(floatingBank); if(d)p.querySelector('#mt-float-scrub').value=Math.round(bankNow(floatingBank)/d*1000);
  }
  function drawWave(canvas,el){
    if(!canvas||!el)return;
    var an=analyserByAudio.get(el),ctx=canvas.getContext('2d'); if(!ctx)return;
    var w=canvas.width,h=canvas.height; ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='currentColor';ctx.lineWidth=1.5;ctx.beginPath();
    if(an){
      var a=new Uint8Array(an.fftSize);an.getByteTimeDomainData(a);
      for(var i=0;i<a.length;i++){var x=i/(a.length-1)*w,y=(a[i]/255)*h;(i?ctx.lineTo(x,y):ctx.moveTo(x,y));}
    }else{ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);}
    ctx.stroke();
  }
  function drawFloatLoop(){
    cancelAnimationFrame(floatRaf);
    function step(){
      var p=document.getElementById('mt-float-player');
      if(p&&!p.hidden&&floatingBank.length){drawWave(p.querySelector('#mt-float-wave'),bankMaster(floatingBank));updateFloat();}
      floatRaf=requestAnimationFrame(step);
    }
    step();
  }

  function decorateMixer(){
    var rows=Array.from(document.querySelectorAll('.trk[data-i]'));
    if(!rows.length)return;
    if(rows.length!==lastRowCount || currentBank.length!==rows.length){
      currentBank=allAudios.slice(-rows.length); lastRowCount=rows.length;
    }
    rows.forEach(function(row,i){
      if(!row.querySelector('.mt-track-wave')){
        var c=document.createElement('canvas');c.className='mt-track-wave';c.width=300;c.height=36;c.setAttribute('aria-label','Live waveform for '+((row.querySelector('.tname')||{}).textContent||'track'));
        var name=row.querySelector('.tname'); if(name)name.insertAdjacentElement('afterend',c); else row.appendChild(c);
      }
      drawWave(row.querySelector('.mt-track-wave'),currentBank[i]);
    });
    var transport=document.querySelector('.transport');
    if(transport&&!transport.querySelector('.mt-song-wave')){
      var mc=document.createElement('canvas');mc.className='mt-song-wave';mc.width=900;mc.height=72;mc.setAttribute('aria-label','Song waveform');transport.appendChild(mc);
    }
    var master=currentBank[0]; var sw=document.querySelector('.mt-song-wave'); if(sw)drawWave(sw,master);

    var float=document.getElementById('mt-float-player');
    if(float && floatingBank.length && currentBank.length && currentBank[0]!==floatingBank[0] && location.hash.indexOf('#/song/')===0){
      float.hidden=false;
    }
  }

  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('#play');
    if(b && floatingBank.length && currentBank.length && currentBank[0]!==floatingBank[0]){
      stopBank(floatingBank); floatingBank=[]; preserveSet.clear(); var p=document.getElementById('mt-float-player'); if(p)p.hidden=true;
    }
  },true);

  function setMediaSession(){
    if(!('mediaSession' in navigator)||!floatingBank.length)return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({title:floatingTitle||'Practice mixer',artist:'Messiah Tour Canada',album:'Band Portal'});
      navigator.mediaSession.setActionHandler('play',function(){playBank(floatingBank);});
      navigator.mediaSession.setActionHandler('pause',function(){pauseBank(floatingBank);});
      navigator.mediaSession.setActionHandler('seekbackward',function(d){setBankTime(floatingBank,Math.max(0,bankNow(floatingBank)-(d.seekOffset||10)));});
      navigator.mediaSession.setActionHandler('seekforward',function(d){setBankTime(floatingBank,Math.min(bankDuration(floatingBank),bankNow(floatingBank)+(d.seekOffset||10)));});
      navigator.mediaSession.setActionHandler('seekto',function(d){if(d.seekTime!=null)setBankTime(floatingBank,d.seekTime);});
    }catch(e){}
  }

  var mo=new MutationObserver(function(){decorateMixer();});
  mo.observe(document.documentElement,{childList:true,subtree:true});
  setInterval(decorateMixer,120);
})();
