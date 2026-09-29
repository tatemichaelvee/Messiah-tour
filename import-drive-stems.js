/* Admin-only Drive -> Supabase stem importer. Uses the current signed-in admin JWT. */
(function(){
  'use strict';
  var CFG=window.MUSIC_ROOM_CONFIG;
  if(!CFG||!window.supabase) return;
  var client=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
  var SONGS=['my-declaration','makanaka-jesu','my-witness','ndamuona','makomborero','mumoyo','tawanirwa-nyasha','kudzai-mwari','rarama','ndinobuda','salt','tangai-neni','guta','hallelujah'];
  var busy=false;

  async function runAll(btn,msg){
    if(busy) return; busy=true; btn.disabled=true;
    try{
      var s=await client.auth.getSession();
      var token=s.data&&s.data.session&&s.data.session.access_token;
      if(!token){ msg.textContent='Sign in again first.'; return; }
      var total=0,errors=0,exists=0;
      for(var i=0;i<SONGS.length;i++){
        var song=SONGS[i]; msg.textContent='Importing '+(i+1)+'/'+SONGS.length+': '+song.replace(/-/g,' ')+'…';
        try{
          var r=await fetch(CFG.supabaseUrl+'/functions/v1/copy-drive-stems?song='+encodeURIComponent(song),{headers:{Authorization:'Bearer '+token}});
          var data=await r.json();
          if(!r.ok) throw new Error(data.error||('HTTP '+r.status));
          (data.results||[]).forEach(function(x){ if(x.status==='copied') total++; if(x.status==='exists') exists++; if(x.status==='error') errors++; });
        }catch(e){ errors++; }
      }
      msg.textContent='Import finished: '+total+' new stem'+(total===1?'':'s')+' copied'+(exists?' · '+exists+' already there':'')+(errors?' · '+errors+' error'+(errors===1?'':'s'):'')+'. Refresh a song page to load the new tracks into the Practice mixer.';
    }finally{busy=false;btn.disabled=false;}
  }

  function inject(){
    if(document.getElementById('drive-import-card')) return;
    var adminLink=document.querySelector('a[href="#/band"]');
    if(!adminLink) return;
    var host=document.querySelector('main') || document.getElementById('app');
    if(!host) return;
    var card=document.createElement('div');
    card.className='card admin';
    card.id='drive-import-card';
    card.style.margin='20px 0';
    card.innerHTML='<span class="admin-tag">Admin</span><h2>Import Drive stems</h2><p class="muted" style="margin:0">Copies the shared MMM Performance Stems and Messiah Tour Drive stems into Supabase so they work in the Practice mixer.</p><div class="tp-row" style="margin-top:12px"><button class="btn primary" id="drive-import-go">Import shared stems</button><span class="muted" id="drive-import-msg"></span></div>';
    if(host.firstChild) host.insertBefore(card,host.firstChild); else host.appendChild(card);
    var btn=document.getElementById('drive-import-go'),msg=document.getElementById('drive-import-msg');
    btn.onclick=function(){runAll(btn,msg);};
  }

  new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',function(){setTimeout(inject,0);});
  setTimeout(inject,0);
})();
