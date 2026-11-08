// Billaura Android app (APK): the Android WebView has no Web Bluetooth. This file adds a small
// navigator.bluetooth look-alike on top of the native BluetoothLe plugin, so the existing
// receipt-printer code (receipt.js) works unchanged inside the app. Does nothing in a normal browser.
//
// Hardened for MXW01 / cat-family thermal printers:
// - request high connection priority after connect
// - conservative MTU + inter-packet delay (printers drop data when flooded)
// - reliable notification listener key matching the plugin
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || (navigator && navigator.bluetooth)) return;
  var BLE = (C.Plugins && C.Plugins.BluetoothLe) || (C.registerPlugin && C.registerPlugin('BluetoothLe'));
  if (!BLE) return;

  function toHex(v) {
    var u = v instanceof Uint8Array ? v : (v && v.buffer ? new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength) : new Uint8Array(v || []));
    var s = '';
    for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }
  function fromHex(h) {
    var out = [], s = String(h || '').replace(/[^0-9a-fA-F]/g, '');
    for (var i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
    return new DataView(Uint8Array.from(out).buffer);
  }
  var low = function (u) { return String(u || '').toLowerCase(); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var inited = null;
  function init() {
    return inited || (inited = BLE.initialize({}).catch(function (e) { inited = null; throw e; }));
  }
  function nf(msg) { var e = new Error(msg); e.name = 'NotFoundError'; return e; }

  function Characteristic(dev, svcUuid, c) {
    var devId = dev.id;
    this.uuid = low(c.uuid);
    this.properties = c.properties || {};
    var me = this;
    var key = 'notification|' + devId + '|' + low(svcUuid) + '|' + this.uuid;
    var subs = [];
    var handle = null;
    var base = { deviceId: devId, service: low(svcUuid), characteristic: this.uuid };
    var props = this.properties;

    function send(v, noResp) {
      // Split to negotiated MTU so a big chunk is never silently truncated.
      // Also insert a short delay between every fragment – MXW01 / cat printers
      // frequently drop data when the Android BLE stack floods them.
      var u = v instanceof Uint8Array
        ? v
        : new Uint8Array(v.buffer ? v.buffer.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength) : v);
      var max = Math.max(20, (dev.mtu || 23) - 3);
      // Cap at 180 even if MTU is higher – some MXW01 firmwares misbehave above ~200
      if (max > 180) max = 180;
      var p = Promise.resolve();
      for (var i = 0; i < u.length; i += max) {
        (function (part) {
          p = p.then(function () {
            var opts = Object.assign({ value: toHex(part), timeout: 12000 }, base);
            return (noResp ? BLE.writeWithoutResponse : BLE.write)(opts);
          }).then(function () { return sleep(12); }); // ~12 ms between packets
        })(u.slice(i, i + max));
      }
      return p;
    }

    this.writeValue = function (v) { return send(v, false); };
    this.writeValueWithoutResponse = function (v) {
      return send(v, !!props.writeWithoutResponse || !props.write);
    };
    this.addEventListener = function (t, fn) {
      if (t === 'characteristicvaluechanged') subs.push(fn);
    };
    this.removeEventListener = function (t, fn) {
      subs = subs.filter(function (x) { return x !== fn; });
    };
    this.startNotifications = function () {
      // Remove any previous listener for this characteristic first
      return Promise.resolve(
        handle && handle.remove ? handle.remove() : null
      ).catch(function () {}).then(function () {
        return BLE.addListener(key, function (ev) {
          var dv = fromHex(ev && ev.value);
          me.value = dv;
          subs.slice().forEach(function (f) {
            try { f({ target: me }); } catch (e) {}
          });
        });
      }).then(function (h) {
        handle = h;
        return BLE.startNotifications(base);
      }).then(function () { return me; });
    };
    this.stopNotifications = function () {
      return BLE.stopNotifications(base).then(function () {
        if (handle && handle.remove) handle.remove();
        handle = null;
        return me;
      }).catch(function () { return me; });
    };
  }

  function Service(dev, s) {
    this.uuid = low(s.uuid);
    var chars = (s.characteristics || []).map(function (c) {
      return new Characteristic(dev, s.uuid, c);
    });
    this.getCharacteristics = function () { return Promise.resolve(chars); };
    this.getCharacteristic = function (u) {
      var c = chars.filter(function (x) { return x.uuid === low(u); })[0];
      return c ? Promise.resolve(c) : Promise.reject(nf('Characteristic not found'));
    };
  }

  function Device(d) {
    var me = this, listeners = [], handle = null;
    this.id = d.deviceId;
    this.name = d.name || '';
    this.mtu = 23;
    this.gatt = {
      connected: false,
      connect: function () {
        return init().then(function () {
          // Clean up previous disconnect listener
          return Promise.resolve(handle && handle.remove ? handle.remove() : null).catch(function () {});
        }).then(function () {
          return BLE.addListener('disconnected|' + me.id, function () {
            me.gatt.connected = false;
            listeners.slice().forEach(function (f) {
              try { f({ target: me }); } catch (e) {}
            });
          });
        }).then(function (h) {
          handle = h;
          return BLE.connect({ deviceId: me.id, timeout: 20000 });
        }).then(function () {
          me.gatt.connected = true;
          // High priority helps bulk raster transfers on Android
          return BLE.requestConnectionPriority
            ? BLE.requestConnectionPriority({ deviceId: me.id, connectionPriority: 1 }).catch(function () {})
            : Promise.resolve();
        }).then(function () {
          return BLE.getMtu({ deviceId: me.id }).then(
            function (r) { me.mtu = Number(r && r.value) || 23; },
            function () { me.mtu = 23; }
          );
        }).then(function () {
          // Give the stack a moment after MTU / priority change
          return sleep(80);
        }).then(function () { return me.gatt; });
      },
      disconnect: function () {
        me.gatt.connected = false;
        try { return BLE.disconnect({ deviceId: me.id }); } catch (e) {}
      },
      getPrimaryService: function (u) {
        return BLE.getServices({ deviceId: me.id }).then(function (r) {
          var wanted = low(u);
          var s = (r.services || []).filter(function (x) { return low(x.uuid) === wanted; })[0];
          // Some MXW01 units expose AF30 instead of AE30
          if (!s && wanted === '0000ae30-0000-1000-8000-00805f9b34fb') {
            s = (r.services || []).filter(function (x) {
              return low(x.uuid) === '0000af30-0000-1000-8000-00805f9b34fb';
            })[0];
          }
          if (!s) throw nf('Service not found');
          return new Service(me, s);
        });
      }
    };
    this.addEventListener = function (t, fn) {
      if (t === 'gattserverdisconnected') listeners.push(fn);
    };
  }

  navigator.bluetooth = {
    requestDevice: function (opts) {
      opts = opts || {};
      var o = {};
      if (opts.optionalServices) o.optionalServices = opts.optionalServices.map(low);
      if (opts.acceptAllDevices) o.allowDuplicates = false;
      return init().then(function () { return BLE.requestDevice(o); }).then(function (d) {
        return new Device(d);
      });
    }
  };
  window.BILLAURA_NATIVE_BLE = true;
})();
