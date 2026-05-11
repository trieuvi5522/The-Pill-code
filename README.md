# Shelly Modbus RTU Module

Module này dùng cho **Shelly Script** trên Shelly The Pill hoặc thiết bị Shelly có hỗ trợ `UART.get()` để giao tiếp **Modbus RTU** qua UART/RS485.

Phiên bản này là bản **V2 No Queue**:

- Chỉ xử lý **1 request Modbus tại một thời điểm**.
- Muốn đọc nhiều thanh ghi thì gọi lệnh kế tiếp trong `onDone`.
- Cách này ổn định hơn trên Shelly Script so với queue tự động.
- Đã test thành công với FC04 đọc các thanh ghi `0x0000`, `0x0003`, `0x0008`.

---

## File module

Lưu code module vào file ví dụ:

```text
shelly_modbus_rtu_module.js
```

Trong Shelly Script, bạn có thể copy toàn bộ nội dung file này vào đầu script, sau đó viết phần logic project ở bên dưới.

---

## Module 1: `modbus_config()`

Hàm này dùng để cấu hình UART Modbus RTU.

### Cú pháp duy nhất được hỗ trợ

```javascript
modbus_config({
  Baudrate: 9600,
  Mode: "8N1"
});
```

### Mode hỗ trợ

```text
8N1
8E1
8O1
```

### Ví dụ

```javascript
modbus_config({
  Baudrate: 9600,
  Mode: "8N1"
});
```

### Lưu ý

Module **không nhận** kiểu khai báo tách riêng `DataBits`, `Parity`, `StopBits`.

Ví dụ sau sẽ bị từ chối:

```javascript
modbus_config({
  Baudrate: 9600,
  DataBits: 8,
  Parity: "Even",
  StopBits: 1
});
```

Khi cấu hình sai, Shelly console sẽ in lỗi bằng `print()`.

---

## Module 2: `readmodbus()`

Hàm này dùng để gửi lệnh Modbus RTU.

Tên hàm là `readmodbus()`, nhưng module hỗ trợ cả đọc và ghi:

| Function Code | Ý nghĩa |
|---|---|
| FC03 | Read Holding Registers |
| FC04 | Read Input Registers |
| FC06 | Write Single Register |
| FC16 | Write Multiple Registers |

---

## Đọc thanh ghi FC03 / FC04

### Cú pháp

```javascript
readmodbus({
  SlaveID: 1,
  Function: 4,
  Register: 0x0000,
  Quantity: 1,
  Type: "u16",
  Scale: 0.1,
  Decimals: 1,

  onValue: function (value, result) {
    print("Value = " + value);
    print("Raw = " + result.raw);
  },

  onError: function (err) {
    print("Read error: " + JSON.stringify(err));
  },

  onDone: function (result) {
    print("Read done");
  }
});
```

---

## Tham số đọc

| Tham số | Bắt buộc | Mô tả |
|---|---:|---|
| `SlaveID` | Có | ID của thiết bị Modbus |
| `Function` | Có | `3` hoặc `4` khi đọc |
| `Register` | Có | Địa chỉ thanh ghi, ví dụ `0x0000` |
| `Quantity` | Có | Số lượng thanh ghi cần đọc |
| `Type` | Không | Kiểu dữ liệu: `u16`, `s16`, `u32`, `s32` |
| `Scale` | Không | Hệ số nhân giá trị raw |
| `Decimals` | Không | Số chữ số sau dấu phẩy |
| `WordOrder` | Không | Dùng cho dữ liệu 32-bit, mặc định `ABCD`; có thể dùng `CDAB` |
| `onValue` | Không | Callback khi đọc được giá trị |
| `onError` | Không | Callback khi lỗi hoặc timeout |
| `onDone` | Không | Callback luôn chạy sau khi request kết thúc |

---

## Kiểu dữ liệu hỗ trợ

| Type | Mô tả |
|---|---|
| `u16` | Unsigned 16-bit |
| `s16` | Signed 16-bit |
| `u32` | Unsigned 32-bit, 2 registers |
| `s32` | Signed 32-bit, 2 registers |

---

## Ví dụ đọc Input Register FC04

Ví dụ đọc điện áp từ Slave ID `1`, thanh ghi `0x0000`, raw scale `0.1`.

```javascript
modbus_config({
  Baudrate: 9600,
  Mode: "8N1"
});

readmodbus({
  SlaveID: 1,
  Function: 4,
  Register: 0x0000,
  Quantity: 1,
  Type: "u16",
  Scale: 0.1,
  Decimals: 1,

  onValue: function (value, result) {
    print("Voltage = " + value);
    print("Raw = " + result.raw);
  },

  onError: function (err) {
    print("Error = " + JSON.stringify(err));
  }
});
```

---

## Đọc nhiều thanh ghi tuần tự

Module này chỉ chạy 1 request tại một thời điểm. Vì vậy không gọi nhiều `readmodbus()` liên tiếp cùng lúc.

Cách đúng là gọi lệnh tiếp theo trong `onDone`.

Ví dụ đọc 3 thanh ghi:

```javascript
const SLAVE_ID = 1;
const FC = 4;
const DELAY_MS = 500;

function readVoltage() {
  readmodbus({
    SlaveID: SLAVE_ID,
    Function: FC,
    Register: 0x0000,
    Quantity: 1,
    Type: "u16",
    Scale: 0.1,
    Decimals: 1,

    onValue: function (value, result) {
      print("Voltage = " + value);
    },

    onDone: function () {
      Timer.set(DELAY_MS, false, function () {
        readCurrent();
      });
    }
  });
}

function readCurrent() {
  readmodbus({
    SlaveID: SLAVE_ID,
    Function: FC,
    Register: 0x0003,
    Quantity: 1,
    Type: "u16",
    Scale: 0.01,
    Decimals: 2,

    onValue: function (value, result) {
      print("Current = " + value);
    },

    onDone: function () {
      Timer.set(DELAY_MS, false, function () {
        readActivePower();
      });
    }
  });
}

function readActivePower() {
  readmodbus({
    SlaveID: SLAVE_ID,
    Function: FC,
    Register: 0x0008,
    Quantity: 1,
    Type: "s16",
    Scale: 1,
    Decimals: 0,

    onValue: function (value, result) {
      print("Active Power = " + value);
    },

    onDone: function () {
      print("Read cycle done");
    }
  });
}

readVoltage();
```

---

## Ghi 1 thanh ghi FC06

```javascript
readmodbus({
  SlaveID: 1,
  Function: 6,
  Register: 0x0001,
  Value: 123,

  onDone: function (result) {
    print("Write FC06 done");
  },

  onError: function (err) {
    print("Write FC06 error: " + JSON.stringify(err));
  }
});
```

---

## Ghi nhiều thanh ghi FC16

```javascript
readmodbus({
  SlaveID: 1,
  Function: 16,
  Register: 0x0001,
  Values: [100, 200, 300],

  onDone: function (result) {
    print("Write FC16 done");
  },

  onError: function (err) {
    print("Write FC16 error: " + JSON.stringify(err));
  }
});
```

---

## Callback result object

Khi đọc thành công, `onValue(value, result)` trả về:

```javascript
{
  ok: true,
  kind: "read",
  slaveId: 1,
  functionCode: 4,
  register: 0x0000,
  quantity: 1,
  raw: 2168,
  value: 216.8,
  words: [2168],
  frame: [...]
}
```

Trong đó:

| Field | Mô tả |
|---|---|
| `raw` | Giá trị raw sau khi parse kiểu dữ liệu |
| `value` | Giá trị sau khi nhân `Scale` và làm tròn `Decimals` |
| `words` | Mảng register word 16-bit |
| `frame` | Frame response Modbus đã nhận |

---

## Timeout và lỗi

Nếu thiết bị không trả lời, module sẽ in log:

```text
Modbus timeout: Slave=1, FC=4, Register=0x0000
```

và gọi `onError`.

Ví dụ:

```javascript
onError: function (err) {
  print("Modbus error: " + JSON.stringify(err));
}
```

---

## Lưu ý quan trọng

1. Phải gọi `modbus_config()` trước khi gọi `readmodbus()`.
2. Không gửi nhiều request cùng lúc.
3. Với nhiều thanh ghi, đọc tuần tự bằng `onDone`.
4. Nếu bị `Modbus busy. Request ignored.`, nghĩa là request trước chưa xong.
5. Shelly Script dùng `print()`, không dùng `console.log()`.
6. Kiểm tra kỹ địa chỉ register là dạng `0-based` hay `1-based` theo tài liệu thiết bị.
7. Nếu đọc FC04 không được, thử kiểm tra thiết bị có yêu cầu FC03 hay không.

---

## Minimal project template

```javascript
// Paste shelly_modbus_rtu_module.js here first

modbus_config({
  Baudrate: 9600,
  Mode: "8N1"
});

Timer.set(1000, false, function () {
  readmodbus({
    SlaveID: 1,
    Function: 4,
    Register: 0x0000,
    Quantity: 1,
    Type: "u16",
    Scale: 0.1,
    Decimals: 1,

    onValue: function (value, result) {
      print("Value = " + value);
    },

    onError: function (err) {
      print("Error = " + JSON.stringify(err));
    }
  });
});
```

---

