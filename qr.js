(function (globalScope) {
  "use strict";

  // Compact ISO 18004 QR Code encoder (Byte mode, ECC Level M, Versions 1..10)
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function initGaloisField() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) {
      GF_EXP[j] = GF_EXP[j - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGenerator(ecCount) {
    var poly = [1];
    for (var i = 0; i < ecCount; i++) {
      var next = new Array(poly.length + 1).fill(0);
      var factor = GF_EXP[i];
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecCount) {
    var gen = rsGenerator(ecCount);
    var res = new Uint8Array(data.length + ecCount);
    res.set(data);
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) {
          res[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return res.slice(data.length);
  }

  // [version, totalDataBytes, ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] for ECC Level M
  var VERSION_TABLE_M = [
    null,
    [1, 16, 10, 1, 16, 0, 0],
    [2, 28, 16, 1, 28, 0, 0],
    [3, 44, 26, 1, 44, 0, 0],
    [4, 64, 18, 2, 32, 0, 0],
    [5, 86, 24, 2, 43, 0, 0],
    [6, 108, 16, 4, 27, 0, 0],
    [7, 124, 18, 4, 31, 0, 0],
    [8, 154, 22, 2, 38, 2, 39],
    [9, 182, 22, 3, 36, 2, 37],
    [10, 216, 26, 4, 43, 1, 44],
  ];

  var ALIGN_POS = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  function encodeUtf8(text) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text);
    }
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return new Uint8Array(bytes);
  }

  function pickVersion(byteLength) {
    for (var v = 1; v < VERSION_TABLE_M.length; v++) {
      var countBits = v <= 9 ? 8 : 16;
      var neededBits = 4 + countBits + byteLength * 8;
      if (neededBits <= VERSION_TABLE_M[v][1] * 8) {
        return v;
      }
    }
    throw new Error("QR payload too long (max 213 UTF-8 bytes)");
  }

  function buildCodewords(bytes, version) {
    var spec = VERSION_TABLE_M[version];
    var totalDataBytes = spec[1];
    var ecPerBlock = spec[2];
    var g1Blocks = spec[3];
    var g1Data = spec[4];
    var g2Blocks = spec[5];
    var g2Data = spec[6];

    var bits = [];
    function pushBits(val, len) {
      for (var i = len - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }

    pushBits(4, 4); // Byte mode indicator
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) {
      pushBits(bytes[i], 8);
    }

    var maxBits = totalDataBytes * 8;
    var termLen = Math.min(4, maxBits - bits.length);
    pushBits(0, termLen);
    while (bits.length % 8 !== 0) bits.push(0);

    var pad = [0xec, 0x11];
    var padIdx = 0;
    while (bits.length < maxBits) {
      pushBits(pad[padIdx % 2], 8);
      padIdx++;
    }

    var dataBytes = new Uint8Array(totalDataBytes);
    for (var b = 0; b < totalDataBytes; b++) {
      var val = 0;
      for (var k = 0; k < 8; k++) {
        val = (val << 1) | bits[b * 8 + k];
      }
      dataBytes[b] = val;
    }

    var dataBlocks = [];
    var ecBlocks = [];
    var offset = 0;
    for (var b1 = 0; b1 < g1Blocks; b1++) {
      var slice1 = dataBytes.slice(offset, offset + g1Data);
      offset += g1Data;
      dataBlocks.push(slice1);
      ecBlocks.push(rsEncode(slice1, ecPerBlock));
    }
    for (var b2 = 0; b2 < g2Blocks; b2++) {
      var slice2 = dataBytes.slice(offset, offset + g2Data);
      offset += g2Data;
      dataBlocks.push(slice2);
      ecBlocks.push(rsEncode(slice2, ecPerBlock));
    }

    var result = [];
    var maxDataLen = Math.max(g1Data, g2Data);
    for (var c = 0; c < maxDataLen; c++) {
      for (var d = 0; d < dataBlocks.length; d++) {
        if (c < dataBlocks[d].length) result.push(dataBlocks[d][c]);
      }
    }
    for (var e = 0; e < ecPerBlock; e++) {
      for (var f = 0; f < ecBlocks.length; f++) {
        result.push(ecBlocks[f][e]);
      }
    }
    return new Uint8Array(result);
  }

  function makeMatrix(version) {
    var size = version * 4 + 17;
    var modules = Array.from({ length: size }, function () {
      return new Uint8Array(size);
    });
    var reserved = Array.from({ length: size }, function () {
      return new Uint8Array(size);
    });

    function setMod(r, c, dark, isReserved) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      modules[r][c] = dark ? 1 : 0;
      if (isReserved) reserved[r][c] = 1;
    }

    function drawFinder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var r = r0 + dr;
          var c = c0 + dc;
          if (r < 0 || c < 0 || r >= size || c >= size) continue;
          var inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          var dark =
            inBox &&
            (dr === 0 ||
              dr === 6 ||
              dc === 0 ||
              dc === 6 ||
              (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setMod(r, c, dark, true);
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      setMod(6, i, i % 2 === 0, true);
      setMod(i, 6, i % 2 === 0, true);
    }

    var align = ALIGN_POS[version];
    for (var a = 0; a < align.length; a++) {
      for (var b = 0; b < align.length; b++) {
        var ar = align[a];
        var ac = align[b];
        if (reserved[ar][ac]) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var isDark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setMod(ar + dr, ac + dc, isDark, true);
          }
        }
      }
    }

    setMod(4 * version + 9, 8, true, true);

    // Reserve format areas
    for (var f = 0; f < 9; f++) {
      if (f !== 6) {
        reserved[8][f] = 1;
        reserved[f][8] = 1;
      }
    }
    for (var f2 = 0; f2 < 8; f2++) {
      reserved[8][size - 1 - f2] = 1;
      reserved[size - 1 - f2][8] = 1;
    }

    // Version info for >= 7
    if (version >= 7) {
      var vInfo = version << 12;
      var g = 0x1f25;
      for (var shift = 5; shift >= 0; shift--) {
        if ((vInfo >> (shift + 12)) & 1) vInfo ^= g << shift;
      }
      var fullV = (version << 12) | vInfo;
      for (var p = 0; p < 18; p++) {
        var bit = ((fullV >> p) & 1) === 1;
        var row = Math.floor(p / 3);
        var col = size - 11 + (p % 3);
        setMod(row, col, bit, true);
        setMod(col, row, bit, true);
      }
    }

    return { size: size, modules: modules, reserved: reserved };
  }

  function placeData(matrix, codewords) {
    var size = matrix.size;
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    var up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var step = 0; step < size; step++) {
        var row = up ? size - 1 - step : step;
        for (var dx = 0; dx < 2; dx++) {
          var c = col - dx;
          if (matrix.reserved[row][c]) continue;
          var dark = false;
          if (bitIdx < totalBits) {
            dark = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          matrix.modules[row][c] = dark ? 1 : 0;
        }
      }
      up = !up;
    }
  }

  function maskCondition(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function writeFormatInfo(modules, size, mask) {
    // ECC Level M = 00
    var data = (0 << 3) | mask;
    var rem = data << 10;
    for (var i = 4; i >= 0; i--) {
      if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
    }
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (var k = 0; k < 15; k++) {
      var bit = ((bits >> k) & 1) === 1 ? 1 : 0;
      if (k < 6) modules[k][8] = bit;
      else if (k < 8) modules[k + 1][8] = bit;
      else modules[size - 15 + k][8] = bit;

      if (k < 8) modules[8][size - 1 - k] = bit;
      else if (k < 9) modules[8][7] = bit;
      else modules[8][14 - k] = bit;
    }
  }

  function penaltyScore(modules, size) {
    var score = 0;
    for (var r = 0; r < size; r++) {
      var runColor = modules[r][0];
      var runLen = 1;
      for (var c = 1; c < size; c++) {
        if (modules[r][c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = modules[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (var c2 = 0; c2 < size; c2++) {
      var runColor2 = modules[0][c2];
      var runLen2 = 1;
      for (var r2 = 1; r2 < size; r2++) {
        if (modules[r2][c2] === runColor2) {
          runLen2++;
        } else {
          if (runLen2 >= 5) score += 3 + (runLen2 - 5);
          runColor2 = modules[r2][c2];
          runLen2 = 1;
        }
      }
      if (runLen2 >= 5) score += 3 + (runLen2 - 5);
    }
    for (var r3 = 0; r3 < size - 1; r3++) {
      for (var c3 = 0; c3 < size - 1; c3++) {
        var v = modules[r3][c3];
        if (v === modules[r3][c3 + 1] && v === modules[r3 + 1][c3] && v === modules[r3 + 1][c3 + 1]) {
          score += 3;
        }
      }
    }
    return score;
  }

  function createQrMatrix(text) {
    var bytes = encodeUtf8(text);
    var version = pickVersion(bytes.length);
    var codewords = buildCodewords(bytes, version);
    var base = makeMatrix(version);
    placeData(base, codewords);

    var bestMask = 0;
    var bestScore = Infinity;
    var bestModules = null;

    for (var m = 0; m < 8; m++) {
      var copy = base.modules.map(function (row) {
        return new Uint8Array(row);
      });
      for (var r = 0; r < base.size; r++) {
        for (var c = 0; c < base.size; c++) {
          if (!base.reserved[r][c] && maskCondition(m, r, c)) {
            copy[r][c] ^= 1;
          }
        }
      }
      writeFormatInfo(copy, base.size, m);
      var score = penaltyScore(copy, base.size);
      if (score < bestScore) {
        bestScore = score;
        bestMask = m;
        bestModules = copy;
      }
    }

    return { size: base.size, modules: bestModules, version: version, mask: bestMask };
  }

  function renderQrToCanvas(canvas, text) {
    var qr = createQrMatrix(text);
    var quiet = 4;
    var total = qr.size + quiet * 2;
    var scale = Math.max(2, Math.floor(canvas.width / total));
    var pixelSize = total * scale;
    canvas.width = pixelSize;
    canvas.height = pixelSize;

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pixelSize, pixelSize);
    ctx.fillStyle = "#000000";

    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  var api = { createQrMatrix: createQrMatrix, renderQrToCanvas: renderQrToCanvas };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.VertexQR = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
