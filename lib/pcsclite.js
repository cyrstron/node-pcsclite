const { EventEmitter } = require("events");

/* Make sure we choose the correct build directory */
const { PCSCLite, CardReader } = require("bindings")("pcsclite.node");

inherits(PCSCLite, EventEmitter);
inherits(CardReader, EventEmitter);

var parse_readers_string = function (readers_str) {
  // Borrowed from https://github.com/pokusew/node-pcsclite
  try {
    const string = readers_str.toString().slice(0, -1);
    // it looks like
    // ACS ACR122U PICC Interface\u0000ACS ACR122U PICC Interface 01\u0000\u0000
    // [reader_name]\u0000[reader_name]\u0000\u0000
    //              ^separator         ^separator^end_separator

    // returns readers in array
    // like [ 'ACS ACR122U PICC Interface', 'ACS ACR122U PICC Interface 01' ]
    return string.split("\u0000").slice(0, -1);
  } catch (e) {
    return [];
  }
};

/*
 * It returns an array with the elements contained in a that aren't contained in b
 */
function diff(a, b) {
  return a.filter((i) => !b.includes(i));
}

module.exports = function () {
  const readers = {};
  const p = new PCSCLite();

  p.readers = readers;

  process.nextTick(function () {
    p.start(function (err, data) {
      if (err) {
        return p.emit("error", err);
      }

      const names = parse_readers_string(data);
      const current_names = Object.keys(readers);
      const new_names = diff(names, current_names);
      const removed_names = diff(current_names, names);

      new_names.forEach((name) => {
        const r = new CardReader(name);

        r.on("_end", function () {
          r.removeAllListeners("status");
          r.emit("end");
          delete readers[name];
        });

        readers[name] = r;

        r.get_status((err, state, atr) => {
          if (err) {
            return r.emit("error", err);
          }

          var status = { state: state };
          if (atr) {
            status.atr = atr;
          }

          r.emit("status", status);
          r.state = state;
        });

        p.emit("reader", r);
      });

      removed_names.forEach(function (name) {
        readers[name].close();
      });
    });
  });

  return p;
};

CardReader.prototype.connect = function (options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = undefined;
  }

  options = options || {};
  options.share_mode = options.share_mode || this.SCARD_SHARE_EXCLUSIVE;

  if (typeof options.protocol === "undefined" || options.protocol === null) {
    options.protocol = this.SCARD_PROTOCOL_T0 | this.SCARD_PROTOCOL_T1;
  }

  if (!this.connected) {
    this._connect(options.share_mode, options.protocol, cb);
  } else {
    cb();
  }
};

CardReader.prototype.disconnect = function (disposition, cb) {
  if (typeof disposition === "function") {
    cb = disposition;
    disposition = undefined;
  }

  if (typeof disposition !== "number") {
    disposition = this.SCARD_UNPOWER_CARD;
  }

  if (this.connected) {
    this._disconnect(disposition, cb);
  } else {
    cb();
  }
};

CardReader.prototype.transmit = function (data, res_len, protocol, cb) {
  if (!this.connected) {
    return cb(new Error("Card Reader not connected"));
  }

  this._transmit(data, res_len, protocol, cb);
};

CardReader.prototype.control = function (data, control_code, res_len, cb) {
  if (!this.connected) {
    return cb(new Error("Card Reader not connected"));
  }

  const output = Buffer.alloc(res_len);

  this._control(data, control_code, output, (err, len) => {
    if (err) {
      return cb(err);
    }

    cb(err, output.subarray(0, len));
  });
};

CardReader.prototype.SCARD_CTL_CODE = function (code) {
  var isWin = /^win/.test(process.platform);
  if (isWin) {
    return (0x31 << 16) | (code << 2);
  } else {
    return 0x42000000 + code;
  }
};

// extend prototype
function inherits(target, source) {
  for (var k in source.prototype) {
    target.prototype[k] = source.prototype[k];
  }
}
