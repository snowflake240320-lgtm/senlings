const CACHE_NAME = 'senlings-v0.1.2';

self.addEventListener("install", (event) => {
  console.log("SW: Installed");
  // 将来的にはここで「現場モード」に必要な資産をキャッシュする
});

self.addEventListener("activate", (event) => {
  console.log("SW: Activated");
});

self.addEventListener("fetch", (event) => {
  // v0ではネットワークをそのまま通すが、フックだけは作っておく
});
