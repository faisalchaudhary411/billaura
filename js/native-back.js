// Billaura Android app (APK): hardware Back button.
//  - closes an open sheet / dialog first
//  - goes back one screen
//  - on Home: "Press back again to exit" (second press within 2 seconds closes the app)
// Does nothing in the browser, the PWA or the Windows app.
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var App = (C.Plugins && C.Plugins.App) || (C.registerPlugin && C.registerPlugin('App'));
  if (!App || !App.addListener) return;
  var last = 0;
  function say(t) { try { if (window.BillauraCore && BillauraCore.toast) return BillauraCore.toast(t, 2000); } catch (e) {} }
  function exitTwice() {
    var now = Date.now();
    if (now - last < 2000) { try { App.exitApp(); } catch (e) {} return; }
    last = now; say('Press back again to exit');
  }
  App.addListener('backButton', function () {
    try {
      var core = window.BillauraCore, appEl = document.getElementById('app');
      var inApp = core && appEl && !appEl.hidden;
      if (!inApp) return exitTwice();                       // landing / sign-in screens
      var mr = document.getElementById('modalRoot');
      if (mr && mr.innerHTML.trim()) return core.closeModal();
      if (core.view && core.view !== 'home') {
        var b = document.getElementById('backBtn');
        if (history.state && history.state.n > 0) return history.back();
        if (b) return b.click();
        return core.setView('home');
      }
      exitTwice();
    } catch (e) { exitTwice(); }
  });
})();
