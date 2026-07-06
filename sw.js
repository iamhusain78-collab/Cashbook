/* Cashbook service worker — cache-first offline shell */
var V='cb-3.1.0';
var ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(V).then(function(c){return c.addAll(ASSETS);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==V;}).map(function(k){return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET')return;
  var url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit)return hit;
      return fetch(req).then(function(res){
        if(res&&res.status===200){
          var copy=res.clone();
          caches.open(V).then(function(c){c.put(req,copy);});
        }
        return res;
      }).catch(function(){
        if(req.mode==='navigate')return caches.match('./index.html');
      });
    })
  );
});
