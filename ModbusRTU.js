// ======================================================
// Shelly Modbus RTU Module
// Device target: Shelly The Pill / Shelly Script UART
// Version: V2 No Queue
// ======================================================
//
// Modules:
// 1. modbus_config({ Baudrate: 9600, Mode: "8N1" })
// 2. readmodbus({...})
//
// Important:
// - This module handles one Modbus request at a time.
// - To read multiple registers, call the next readmodbus() inside onDone.
// - Supported Function Codes:
//   FC03 = Read Holding Registers
//   FC04 = Read Input Registers
//   FC06 = Write Single Register
//   FC16 = Write Multiple Registers
//
// ======================================================


// ======================================================
// MODULE 1: MODBUS CONFIG
// ======================================================
//
// ONLY ACCEPTED FORMAT:
//
// modbus_config({
//   Baudrate: 9600,
//   Mode: "8N1"
// });
//
// Accepted Mode:
// "8N1", "8E1", "8O1"

const MODBUS_CONFIG = {
  uart: UART.get(),
  baudrate: 9600,
  mode: "8N1",
  responseTimeoutMs: 1500,
  maxRxBuffer: 160,
  configured: false
};

function mb_hasKey(obj, key) {
  return obj[key] !== undefined;
}

function mb_pick(obj, names, defaultValue) {
  for (let i = 0; i < names.length; i++) {
    if (obj[names[i]] !== undefined && obj[names[i]] !== null) {
      return obj[names[i]];
    }
  }

  return defaultValue;
}

function mb_isAllowedConfigKey(key) {
  if (key === "Baudrate") return true;
  if (key === "Mode") return true;

  return false;
}

function modbus_config(opt) {
  opt = opt || {};

  for (let key in opt) {
    if (!mb_isAllowedConfigKey(key)) {
      print("Modbus config error: invalid key = " + key);
      print('Only this format is accepted: modbus_config({ Baudrate: 9600, Mode: "8N1" });');

      MODBUS_CONFIG.configured = false;
      return false;
    }
  }

  if (!mb_hasKey(opt, "Baudrate")) {
    print("Modbus config error: missing Baudrate.");
    print('Example: modbus_config({ Baudrate: 9600, Mode: "8N1" });');

    MODBUS_CONFIG.configured = false;
    return false;
  }

  if (!mb_hasKey(opt, "Mode")) {
    print("Modbus config error: missing Mode.");
    print('Example: modbus_config({ Baudrate: 9600, Mode: "8N1" });');

    MODBUS_CONFIG.configured = false;
    return false;
  }

  MODBUS_CONFIG.baudrate = opt.Baudrate;
  MODBUS_CONFIG.mode = String(opt.Mode).toUpperCase();

  if (
    MODBUS_CONFIG.mode !== "8N1" &&
    MODBUS_CONFIG.mode !== "8E1" &&
    MODBUS_CONFIG.mode !== "8O1"
  ) {
    print("Modbus config error: unsupported Mode = " + MODBUS_CONFIG.mode);
    print('Supported Mode: "8N1", "8E1", "8O1"');

    MODBUS_CONFIG.configured = false;
    return false;
  }

  let ok = MODBUS_CONFIG.uart.configure({
    baud: MODBUS_CONFIG.baudrate,
    mode: MODBUS_CONFIG.mode
  });

  if (!ok) {
    print(
      "Modbus UART config failed. Baud=" +
      MODBUS_CONFIG.baudrate +
      ", Mode=" +
      MODBUS_CONFIG.mode
    );

    MODBUS_CONFIG.configured = false;
    return false;
  }

  MODBUS_CONFIG.configured = true;

  print(
    "Modbus UART configured. Baud=" +
    MODBUS_CONFIG.baudrate +
    ", Mode=" +
    MODBUS_CONFIG.mode
  );

  return true;
}


// ======================================================
// MODULE 2: MODBUS COMMAND - V2 NO QUEUE
// ======================================================
//
// Important:
// - Mỗi lần chỉ chạy 1 request.
// - Muốn đọc nhiều thanh ghi thì gọi lệnh tiếp theo trong onDone.
// - Hỗ trợ FC03, FC04, FC06, FC16.
//
// Read example:
//
// readmodbus({
//   SlaveID: 1,
//   Function: 4,
//   Register: 0x0000,
//   Quantity: 1,
//   Type: "u16",
//   Scale: 0.1,
//   Decimals: 1,
//   onValue: function(value, result) {
//     print(value);
//   },
//   onDone: function(result) {
//     // call next request here
//   }
// });

const MODBUS_COMMAND = (function () {
  let rxBuf = "";
  let currentJob = null;
  let responseTimeoutTimer = null;
  let recvStarted = false;

  function byteAt(s, i) {
    return s.charCodeAt(i) & 0xff;
  }

  function bytesToStr(arr) {
    let s = "";

    for (let i = 0; i < arr.length; i++) {
      s += String.fromCharCode(arr[i] & 0xff);
    }

    return s;
  }

  function addByte(arr, value) {
    arr[arr.length] = value & 0xff;
  }

  function roundTo(n, decimals) {
    let factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }

  function parseSigned16(v) {
    return (v & 0x8000) ? (v - 0x10000) : v;
  }

  function parseSigned32(v) {
    return (v > 0x7fffffff) ? (v - 0x100000000) : v;
  }

  function toHex4(n) {
    let s = (n & 0xffff).toString(16).toUpperCase();

    while (s.length < 4) {
      s = "0" + s;
    }

    return "0x" + s;
  }

  function crc16Modbus(bytes) {
    let crc = 0xffff;

    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];

      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xa001;
        } else {
          crc = crc >> 1;
        }
      }
    }

    return [crc & 0xff, (crc >> 8) & 0xff];
  }

  function appendCRC(frame) {
    let crc = crc16Modbus(frame);

    addByte(frame, crc[0]);
    addByte(frame, crc[1]);

    return frame;
  }

  function checkCRC(frame) {
    if (!frame || frame.length < 5) return false;

    let data = [];

    for (let i = 0; i < frame.length - 2; i++) {
      addByte(data, frame[i]);
    }

    let crc = crc16Modbus(data);

    return (
      crc[0] === frame[frame.length - 2] &&
      crc[1] === frame[frame.length - 1]
    );
  }

  function buildReadFrame(slaveId, fc, register, quantity) {
    let frame = [];

    addByte(frame, slaveId);
    addByte(frame, fc);
    addByte(frame, register >> 8);
    addByte(frame, register);
    addByte(frame, quantity >> 8);
    addByte(frame, quantity);

    return appendCRC(frame);
  }

  function buildWriteSingleFrame(slaveId, register, value) {
    let frame = [];

    addByte(frame, slaveId);
    addByte(frame, 0x06);
    addByte(frame, register >> 8);
    addByte(frame, register);
    addByte(frame, value >> 8);
    addByte(frame, value);

    return appendCRC(frame);
  }

  function buildWriteMultipleFrame(slaveId, register, values) {
    let quantity = values.length;
    let byteCount = quantity * 2;

    let frame = [];

    addByte(frame, slaveId);
    addByte(frame, 0x10);
    addByte(frame, register >> 8);
    addByte(frame, register);
    addByte(frame, quantity >> 8);
    addByte(frame, quantity);
    addByte(frame, byteCount);

    for (let i = 0; i < values.length; i++) {
      addByte(frame, values[i] >> 8);
      addByte(frame, values[i]);
    }

    return appendCRC(frame);
  }

  function safeCall(fn, a, b, c) {
    if (typeof fn !== "function") return;

    try {
      fn(a, b, c);
    } catch (e) {
      print("Modbus callback error: " + JSON.stringify(e));
    }
  }

  function clearResponseTimeout() {
    if (responseTimeoutTimer !== null) {
      Timer.clear(responseTimeoutTimer);
      responseTimeoutTimer = null;
    }
  }

  function parseReadValue(job, frame) {
    let words = [];

    for (let i = 0; i < job.quantity; i++) {
      let pos = 3 + i * 2;
      let word = (frame[pos] << 8) | frame[pos + 1];
      words[words.length] = word;
    }

    if (job.quantity === 1) {
      let raw16 = words[0];

      if (job.type === "s16") {
        raw16 = parseSigned16(raw16);
      }

      let value16 = raw16 * job.scale;

      if (job.decimals !== null && job.decimals !== undefined) {
        value16 = roundTo(value16, job.decimals);
      }

      return {
        raw: raw16,
        value: value16,
        words: words
      };
    }

    if (job.quantity === 2) {
      let hiWord = words[0];
      let loWord = words[1];

      if (job.wordOrder === "CDAB") {
        hiWord = words[1];
        loWord = words[0];
      }

      let raw32 = hiWord * 65536 + loWord;

      if (job.type === "s32") {
        raw32 = parseSigned32(raw32);
      }

      let value32 = raw32 * job.scale;

      if (job.decimals !== null && job.decimals !== undefined) {
        value32 = roundTo(value32, job.decimals);
      }

      return {
        raw: raw32,
        value: value32,
        words: words
      };
    }

    return {
      raw: words,
      value: words,
      words: words
    };
  }

  function finishJob(ok, result) {
    clearResponseTimeout();

    let job = currentJob;
    currentJob = null;

    if (!job) return;

    if (ok) {
      if (job.kind === "read") {
        safeCall(job.onValue, result.value, result, job);
      }

      safeCall(job.onDone, result, job);
    } else {
      safeCall(job.onError, result, job);
      safeCall(job.onDone, result, job);
    }
  }

  function handleReadFrame(frame) {
    if (!currentJob) return;

    let job = currentJob;
    let parsed = parseReadValue(job, frame);

    finishJob(true, {
      ok: true,
      kind: "read",
      slaveId: job.slaveId,
      functionCode: job.functionCode,
      register: job.register,
      quantity: job.quantity,
      raw: parsed.raw,
      value: parsed.value,
      words: parsed.words,
      frame: frame
    });
  }

  function handleWriteFrame(frame) {
    if (!currentJob) return;

    let job = currentJob;

    finishJob(true, {
      ok: true,
      kind: "write",
      slaveId: job.slaveId,
      functionCode: job.functionCode,
      register: job.register,
      quantity: job.quantity,
      frame: frame
    });
  }

  function handleExceptionFrame(frame) {
    if (!currentJob) return;

    let job = currentJob;

    finishJob(false, {
      ok: false,
      error: "modbus_exception",
      slaveId: job.slaveId,
      functionCode: job.functionCode,
      register: job.register,
      exceptionCode: frame[2],
      frame: frame
    });
  }

  function scanFrames() {
    if (!currentJob) return;

    let slaveId = currentJob.slaveId;
    let fc = currentJob.functionCode;
    let jobKind = currentJob.kind;
    let jobQuantity = currentJob.quantity;

    let exceptionLen = 5;

    if (rxBuf.length >= exceptionLen) {
      for (let i = 0; i <= rxBuf.length - exceptionLen; i++) {
        if (byteAt(rxBuf, i) !== slaveId) continue;
        if (byteAt(rxBuf, i + 1) !== (fc | 0x80)) continue;

        let exFrame = [];

        for (let j = 0; j < exceptionLen; j++) {
          addByte(exFrame, byteAt(rxBuf, i + j));
        }

        if (!checkCRC(exFrame)) continue;

        rxBuf = rxBuf.slice(i + exceptionLen);
        handleExceptionFrame(exFrame);
        return;
      }
    }

    if (jobKind === "read") {
      let expectedByteCount = jobQuantity * 2;
      let normalLen = 5 + expectedByteCount;

      while (rxBuf.length >= normalLen) {
        for (let a = 0; a <= rxBuf.length - normalLen; a++) {
          if (byteAt(rxBuf, a) !== slaveId) continue;
          if (byteAt(rxBuf, a + 1) !== fc) continue;
          if (byteAt(rxBuf, a + 2) !== expectedByteCount) continue;

          let frame = [];

          for (let b = 0; b < normalLen; b++) {
            addByte(frame, byteAt(rxBuf, a + b));
          }

          if (!checkCRC(frame)) continue;

          rxBuf = rxBuf.slice(a + normalLen);
          handleReadFrame(frame);
          return;
        }

        if (rxBuf.length > normalLen - 1) {
          rxBuf = rxBuf.slice(rxBuf.length - (normalLen - 1));
        }

        return;
      }

      return;
    }

    if (jobKind === "write") {
      let writeLen = 8;

      while (rxBuf.length >= writeLen) {
        for (let c = 0; c <= rxBuf.length - writeLen; c++) {
          if (byteAt(rxBuf, c) !== slaveId) continue;
          if (byteAt(rxBuf, c + 1) !== fc) continue;

          let writeFrame = [];

          for (let d = 0; d < writeLen; d++) {
            addByte(writeFrame, byteAt(rxBuf, c + d));
          }

          if (!checkCRC(writeFrame)) continue;

          rxBuf = rxBuf.slice(c + writeLen);
          handleWriteFrame(writeFrame);
          return;
        }

        if (rxBuf.length > writeLen - 1) {
          rxBuf = rxBuf.slice(rxBuf.length - (writeLen - 1));
        }

        return;
      }

      return;
    }
  }

  function startReceiver() {
    if (recvStarted) return;

    MODBUS_CONFIG.uart.recv(function (data) {
      if (!data || !data.length) return;

      rxBuf += data;

      if (rxBuf.length > MODBUS_CONFIG.maxRxBuffer) {
        rxBuf = rxBuf.slice(rxBuf.length - MODBUS_CONFIG.maxRxBuffer);
      }

      scanFrames();
    });

    recvStarted = true;
  }

  function startTimeout() {
    responseTimeoutTimer = Timer.set(
      MODBUS_CONFIG.responseTimeoutMs,
      false,
      function () {
        responseTimeoutTimer = null;

        if (!currentJob) return;

        let job = currentJob;

        print(
          "Modbus timeout: Slave=" +
          job.slaveId +
          ", FC=" +
          job.functionCode +
          ", Register=" +
          toHex4(job.register)
        );

        finishJob(false, {
          ok: false,
          error: "timeout",
          slaveId: job.slaveId,
          functionCode: job.functionCode,
          register: job.register
        });
      }
    );
  }

  function readmodbus(opt) {
    opt = opt || {};

    if (!MODBUS_CONFIG.configured) {
      print("Modbus is not configured. Call modbus_config() first.");
      return false;
    }

    startReceiver();

    if (currentJob !== null) {
      print("Modbus busy. Request ignored.");
      return false;
    }

    let slaveId = mb_pick(opt, ["SlaveID", "slaveId", "slave_id", "id"], 1);
    let fc = mb_pick(opt, ["Function", "functionCode", "fc"], 4);
    let register = mb_pick(opt, ["Register", "register", "addr", "address"], 0);
    let quantity = mb_pick(opt, ["Quantity", "Quanity", "quantity", "regs", "count"], 1);

    let frame = null;
    let kind = "read";

    if (fc === 3 || fc === 4) {
      kind = "read";
      frame = buildReadFrame(slaveId, fc, register, quantity);
    } else if (fc === 6) {
      kind = "write";
      quantity = 1;

      let value = mb_pick(opt, ["Value", "value"], 0);
      frame = buildWriteSingleFrame(slaveId, register, value);
    } else if (fc === 16) {
      kind = "write";

      let values = mb_pick(opt, ["Values", "values"], []);

      if (!values || values.length < 1) {
        print("FC16 needs Values array.");
        return false;
      }

      quantity = values.length;
      frame = buildWriteMultipleFrame(slaveId, register, values);
    } else {
      print("Unsupported Modbus Function Code: " + fc);
      return false;
    }

    currentJob = {
      kind: kind,
      slaveId: slaveId,
      functionCode: fc,
      register: register,
      quantity: quantity,
      type: mb_pick(opt, ["Type", "type", "DataType", "dataType"], "u16"),
      scale: mb_pick(opt, ["Scale", "scale"], 1),
      decimals: mb_pick(opt, ["Decimals", "decimals"], null),
      wordOrder: mb_pick(opt, ["WordOrder", "wordOrder"], "ABCD"),
      onValue: mb_pick(opt, ["onValue", "OnValue"], null),
      onDone: mb_pick(opt, ["onDone", "OnDone"], null),
      onError: mb_pick(opt, ["onError", "OnError"], null),
      frame: frame
    };

    rxBuf = "";

    print(
      "TX Modbus: Slave=" +
      currentJob.slaveId +
      ", FC=" +
      currentJob.functionCode +
      ", Register=" +
      toHex4(currentJob.register) +
      ", Quantity=" +
      currentJob.quantity
    );

    MODBUS_CONFIG.uart.write(bytesToStr(currentJob.frame));
    startTimeout();

    return true;
  }

  return {
    readmodbus: readmodbus
  };
})();

function readmodbus(opt) {
  return MODBUS_COMMAND.readmodbus(opt);
}
