// Billaura Android app (APK) helper: the Android WebView ignores "download" links, so PDFs,
// images and backups are written to the cache and handed to the share sheet instead.
// Does nothing in the browser, the PWA or the Windows app.
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  function saveBlobUrl(href, name) {
    if (!P.Filesystem || !P.Share) return Promise.resolve();
    return fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      return new Promise(function (res) { var f = new FileReader(); f.onload = function () { res(String(f.result).split(',')[1]); }; f.readAsDataURL(blob); });
    }).then(function (b64) {
      var safe = String(name || 'billaura-file').replace(/[^\w.\- ]+/g, '_');
      return P.Filesystem.writeFile({ path: safe, data: b64, directory: 'CACHE' }).then(function (w) {
        return P.Share.share({ title: safe, url: w.uri, dialogTitle: 'Save or share' });
      });
    }).catch(function () {});
  }
  function isDl(a) { return a && a.download && /^(blob:|data:)/.test(a.href); }
  var oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isDl(this)) { saveBlobUrl(this.href, this.download); return; } return oc.apply(this, arguments); };
  var od = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (e) {
    if (this instanceof HTMLAnchorElement && e && e.type === 'click' && isDl(this)) { saveBlobUrl(this.href, this.download); return true; }
    return od.apply(this, arguments);
  };
})();
