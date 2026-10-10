/* 音読アプリ サーバー（Google Apps Script）
 * このファイルは build-gas.sh で自動生成されています。
 * Apps Script のエディタに、このファイルの中身をすべて貼り付けてください。 */

/*
 * 発音判定エンジン
 * 音声認識の結果（transcript）と課題の英文（target）を照合して、
 * 正確さ（％）・単語ごとの正誤・読めた単語数を計算します。
 * ブラウザでも Node.js（テスト用）でも動きます。
 */
(function (root) {
  'use strict';

  // ---- 短縮形の展開（両側を同じ形にそろえるため） ----
  var CONTRACTIONS = {
    "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
    "he's": 'he is', "she's": 'she is', "it's": 'it is', "that's": 'that is',
    "what's": 'what is', "where's": 'where is', "who's": 'who is', "how's": 'how is',
    "there's": 'there is', "here's": 'here is', "let's": 'let us',
    "i've": 'i have', "you've": 'you have', "we've": 'we have', "they've": 'they have',
    "i'll": 'i will', "you'll": 'you will', "he'll": 'he will', "she'll": 'she will',
    "it'll": 'it will', "we'll": 'we will', "they'll": 'they will', "that'll": 'that will',
    "i'd": 'i would', "you'd": 'you would', "he'd": 'he would', "she'd": 'she would',
    "we'd": 'we would', "they'd": 'they would',
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
    "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
    "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
    "won't": 'will not', "wouldn't": 'would not', "can't": 'can not', "cannot": 'can not',
    "couldn't": 'could not', "shouldn't": 'should not', "mustn't": 'must not',
    "needn't": 'need not', "ain't": 'is not', "o'clock": 'oclock',
    'gonna': 'going to', 'wanna': 'want to', 'gotta': 'got to'
  };

  // ---- 同音語・表記ゆれ（どちらで認識されても正解にする） ----
  var HOMOPHONE_GROUPS = [
    ['to', 'too', 'two'], ['there', 'their'], ['your', 'yore'], ['its', 'it is'],
    ['for', 'four', 'fore'], ['right', 'write', 'rite'], ['know', 'no'], ['knew', 'new'],
    ['hear', 'here'], ['see', 'sea'], ['by', 'buy', 'bye'], ['one', 'won'], ['eight', 'ate'],
    ['meet', 'meat'], ['weak', 'week'], ['son', 'sun'], ['hour', 'our'], ['whole', 'hole'],
    ['wear', 'where', 'ware'], ['flower', 'flour'], ['tail', 'tale'], ['mail', 'male'],
    ['piece', 'peace'], ['blue', 'blew'], ['i', 'eye'], ['be', 'bee'], ['dear', 'deer'],
    ['sail', 'sale'], ['road', 'rode'], ['made', 'maid'], ['plane', 'plain'],
    ['night', 'knight'], ['ok', 'okay'], ['mr', 'mister'], ['dr', 'doctor'],
    ['wait', 'weight'], ['way', 'weigh'], ['would', 'wood'], ['not', 'knot'],
    ['some', 'sum'], ['which', 'witch'], ['whether', 'weather'], ['threw', 'through'],
    ['brake', 'break'], ['steal', 'steel'], ['stair', 'stare'], ['pair', 'pear'],
    ['fair', 'fare'], ['hair', 'hare'], ['hi', 'high'], ['so', 'sew'], ['rain', 'reign'],
    ['red', 'read'], ['led', 'lead'], ['passed', 'past'], ['allowed', 'aloud'],
    ['cent', 'scent', 'sent'], ['caught', 'court'], ['grate', 'great'], ['bored', 'board'],
    ['nose', 'knows'], ['wore', 'war'], ['tee', 'tea'], ['oh', 'o'], ['all right', 'alright'],
    ['color', 'colour'], ['favorite', 'favourite'], ['center', 'centre'], ['theater', 'theatre'],
    ['gray', 'grey'], ['realize', 'realise'], ['honor', 'honour'], ['neighbor', 'neighbour'],
    ['mom', 'mum', 'mam'], ['e-mail', 'email'], ['t-shirt', 'tshirt'], ['okay', 'k']
  ];
  var CANON = {};
  HOMOPHONE_GROUPS.forEach(function (g) {
    g.forEach(function (w) { if (w.indexOf(' ') < 0) CANON[w] = g[0]; });
  });

  // ---- 数字 → 英単語 ----
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
    nine: 'ninth', twelve: 'twelfth' };

  function under100(n) {
    if (n < 20) return [ONES[n]];
    var t = TENS[Math.floor(n / 10)], o = n % 10;
    return o ? [t, ONES[o]] : [t];
  }
  function under1000(n) {
    var h = Math.floor(n / 100), r = n % 100, out = [];
    if (h) out.push(ONES[h], 'hundred');
    if (r || !h) out = out.concat(under100(r));
    return out;
  }
  function numberToWords(n) {
    if (n >= 1000000) return [String(n)];
    if (n >= 1100 && n < 10000 && n % 100 !== 0 && n % 1000 >= 100) {
      // 西暦などは「twenty twenty-six」型で読むことが多い → 認識側も数字で返るので数字同士で比較される
      return under100(Math.floor(n / 100)).concat(n % 100 < 10 ? ['oh'].concat(under100(n % 100)) : under100(n % 100));
    }
    var th = Math.floor(n / 1000), r = n % 1000, out = [];
    if (th) out = out.concat(under1000(th), ['thousand']);
    if (r || !th) out = out.concat(under1000(r));
    return out;
  }
  function ordinalWords(n) {
    var w = numberToWords(n), last = w[w.length - 1];
    if (ORD[last]) w[w.length - 1] = ORD[last];
    else if (/y$/.test(last)) w[w.length - 1] = last.replace(/y$/, 'ieth');
    else w[w.length - 1] = last + 'th';
    return w;
  }

  // 1語（表示上の単語）を、比較用の単位（小文字・記号なし）の配列に変換
  function toUnits(raw) {
    var w = String(raw).toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/[“”"]/g, '')
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');   // 前後の記号を除去
    if (!w) return [];
    // ハイフン・スラッシュ等でつながった語は分割
    var parts = w.split(/[-‐-―\/_.,!?;:()\[\]{}]+/).filter(Boolean);
    var units = [];
    parts.forEach(function (p) {
      p = p.replace(/^'+|'+$/g, '');
      if (!p) return;
      if (CONTRACTIONS[p]) { units = units.concat(CONTRACTIONS[p].split(' ')); return; }
      var m;
      if ((m = p.match(/^(\d+)(st|nd|rd|th)$/))) { units = units.concat(ordinalWords(+m[1])); return; }
      if (/^\d+$/.test(p)) { units = units.concat(numberToWords(+p)); return; }
      if ((m = p.match(/^(\d+)(am|pm)$/))) { units = units.concat(numberToWords(+m[1]), [m[2]]); return; }
      // 所有格の 's は単語本体だけで比較（Tom's → tom）
      if (/'s$/.test(p) && p.length > 2) p = p.slice(0, -2);
      p = p.replace(/'/g, '');
      if (!p) return;
      units.push(p);
    });
    return units.map(function (u) { return CANON[u] || u; });
  }

  // 表示用のトークン列（空白区切り）
  // 日本語（かな・漢字・全角文字・和文の句読点）は「表示だけ」の部分として扱い、音読の対象にしない
  var JA_RE = /([\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+)/;
  var JA_TEST = /^[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+$/;

  // 日本語が主の行か（日本語の文字数×2 ＞ 英字の数）。日本語の行は、数字や英字もすべて表示だけの扱いにする
  var JA_CHAR_G = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;
  function isJaLine(line) {
    var ja = (String(line).match(JA_CHAR_G) || []).length;
    var latin = (String(line).match(/[A-Za-z]/g) || []).length;
    return ja > 0 && ja * 2 > latin;
  }

  // 会話文の話者名（行の先頭の「Ken:」「Ms. Brown:」「A:」など）は読む対象にしない
  //  ・英字で始まる1〜3語＋コロン（: または ：）のあとに本文が続くもの
  //  ・「10:30」のような時刻は対象外（英字で始まらないため）
  var SPEAKER_RE = /^(\s*)((?:[A-Z][A-Za-z'\u2019\-]*\.?)(?:\s+(?:[A-Z][A-Za-z'\u2019\-]*\.?|&|and)){0,2})\s*[:\uFF1A][ \t]*(?=\S)/;
  function speakerLabel(line) {
    var m = String(line).match(SPEAKER_RE);
    return m ? m[2] : '';
  }
  function stripSpeaker(line) { return String(line).replace(SPEAKER_RE, '$1'); }
  function tokenize(text) {
    var tokens = [];
    var src = String(text || '').replace(/\r/g, '');
    // 話者名の行は「Ken: Hello」の形にそろえる（コロンのあとに空白を入れる）
    var lines = src.split('\n').map(function (l) {
      if (isJaLine(l)) return l;
      return l.replace(SPEAKER_RE, function (all, sp, name) { return sp + name + ': '; });
    });
    src = lines.join('\n');
    var lineJa = lines.map(isJaLine), li = 0;
    // 各行の話者名が何語か（「Ms. Brown:」なら2）
    var lineSp = lines.map(function (l, i) { if (lineJa[i]) return 0; var nm = speakerLabel(l); return nm ? nm.split(/\s+/).length : 0; });
    var wi = 0;
    src.split(/(\s+)/).forEach(function (part) {
      if (part === '') return;
      if (/^\s+$/.test(part)) { tokens.push({ text: part, space: true, units: [] }); var nl = (part.match(/\n/g) || []).length; if (nl) { li += nl; wi = 0; } return; }
      if (wi < lineSp[li]) { wi++; tokens.push({ text: part, space: false, speaker: true, units: [] }); return; }
      wi++;
      if (lineJa[li]) { tokens.push({ text: part, space: false, ja: true, units: [] }); return; }
      var hasJa = JA_RE.test(part);
      part.split(JA_RE).forEach(function (seg) {
        if (seg === '') return;
        // 日本語にくっついた数字や記号（例：800年）も日本語の一部として扱う
        if (JA_TEST.test(seg) || (hasJa && !/[A-Za-z]/.test(seg))) { tokens.push({ text: seg, space: false, ja: true, units: [] }); return; }
        tokens.push({ text: seg, space: false, units: toUnits(seg) });
      });
    });
    return tokens;
  }

  // 英語の部分だけを取り出す（お手本の読み上げ用）
  function englishOnly(text) {
    return String(text || '').split(/\n/).filter(function (line) { return !isJaLine(line); }).map(function (line) {
      return stripSpeaker(line).split(JA_RE).filter(function (seg) { return seg && !JA_TEST.test(seg); }).join(' ')
        .replace(/\s+/g, ' ').trim();
    }).filter(function (line) { return /[A-Za-z0-9]/.test(line); }).join('\n');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 単位どうしが一致とみなせるか
  function same(a, b, opts) {
    if (a === b) return true;
    if (opts && opts.strict) return false;
    // 長い単語は1文字程度の違い（綴りゆれ・複数形の聞き取り揺れ）を許容
    var L = Math.max(a.length, b.length);
    if (L >= 6) return levenshtein(a, b) <= 1;
    return false;
  }

  /**
   * 判定のメイン関数
   * @param {string} target 課題の英文
   * @param {string} transcript 音声認識の結果
   * @param {object} [opts] {strict:boolean}
   * @return {{accuracy:number, total:number, correct:number, tokens:Array}}
   */
  function score(target, transcript, opts) {
    return scoreTokens(tokenize(target), transcript, opts);
  }

  // ---------------- 合言葉（録音の使い回し対策） ----------------
  var PHRASE_WORDS = {
    color: ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown', 'black', 'white'],
    animal: ['cat', 'dog', 'lion', 'tiger', 'rabbit', 'monkey', 'panda', 'horse', 'bear', 'fox', 'zebra', 'koala'],
    number: ['three', 'five', 'six', 'seven', 'nine']
  };
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  // 英文の中に出てくる単語は合言葉に使わない（録音にたまたま含まれて合格になるのを防ぐ）
  function makePhrase(text) {
    var used = {};
    tokenize(text || '').forEach(function (t) { t.units.forEach(function (u) { used[u] = true; }); });
    function pickFree(list) {
      var free = list.filter(function (w) { return !toUnits(w).some(function (u) { return used[u] || used[u + 's'] || used[u + 'es']; }); });
      return pick(free.length ? free : list);
    }
    return pickFree(PHRASE_WORDS.color) + ' ' + pickFree(PHRASE_WORDS.animal) + ' ' + pickFree(PHRASE_WORDS.number);
  }
  // 合言葉を入れる位置（英文の途中の文の切れ目。なければ最後）
  function phrasePosition(text) {
    var tokens = tokenize(text), cands = [], words = 0, total = 0;
    tokens.forEach(function (t) { if (t.units.length) total++; });
    tokens.forEach(function (t, i) {
      if (t.units.length) words++;
      if (!t.space && /[.!?]["'”’)]?$/.test(t.text) && words >= 3 && total - words >= 3) cands.push(i + 1);
    });
    if (!cands.length) return tokens.length;
    // 真ん中あたりの切れ目を中心にランダムに選ぶ
    var mid = cands.filter(function (c, k) { return k >= Math.floor(cands.length / 4) && k <= Math.ceil(cands.length * 3 / 4); });
    return pick(mid.length ? mid : cands);
  }
  function phraseTokens(text, phrase, at) {
    var tokens = tokenize(text);
    if (at === null || at === undefined || at < 0 || at > tokens.length) at = tokens.length;
    var sp = { text: ' ', space: true, units: [] };
    var pt = tokenize(phrase).filter(function (t) { return !t.space; }).map(function (t) { t.phrase = true; return t; });
    var mid = [];
    pt.forEach(function (t, k) { if (k) mid.push(sp); mid.push(t); });
    return tokens.slice(0, at).concat([sp, { text: '🔑', space: false, units: [], phraseLabel: true }, sp], mid, [sp], tokens.slice(at));
  }
  // 合言葉つきで判定（合言葉の部分は正確さに含めない）
  function scoreWithPhrase(text, transcript, phrase, at, opts) {
    return scoreTokens(phraseTokens(text, phrase, at), transcript, opts);
  }

  function scoreTokens(tokens, transcript, opts) {
    // 対象側の単位列（どの表示トークンの何番目か）
    var A = [];
    tokens.forEach(function (t, ti) {
      t.units.forEach(function (u) { A.push({ u: u, ti: ti }); });
    });
    var B = [];
    String(transcript || '').split(/\s+/).forEach(function (w) {
      toUnits(w).forEach(function (u) { B.push(u); });
    });

    var n = A.length, m = B.length;
    // LCS（最長共通部分列）で位置合わせ
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) { dp[i] = new Uint16Array(m + 1); }
    for (i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        dp[i][j] = same(A[i - 1].u, B[j - 1], opts) ? dp[i - 1][j - 1] + 1
          : (dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1]);
      }
    }
    var matched = new Array(n);
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (same(A[i - 1].u, B[j - 1], opts) && dp[i][j] === dp[i - 1][j - 1] + 1) {
        matched[i - 1] = true; i--; j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) { i--; } else { j--; }
    }

    // 表示トークンごとに集計（全ての単位が一致したら正解）
    var unitOk = tokens.map(function () { return { all: 0, ok: 0 }; });
    A.forEach(function (a, k) { unitOk[a.ti].all++; if (matched[k]) unitOk[a.ti].ok++; });

    var total = 0, correct = 0, pAll = 0, pOk = 0;
    var out = tokens.map(function (t, ti) {
      if (t.space) return { text: t.text, status: 'space' };
      if (t.phraseLabel) return { text: t.text, status: 'phrase-label' };
      if (t.phrase) {
        pAll += unitOk[ti].all; pOk += unitOk[ti].ok;
        return { text: t.text, status: unitOk[ti].ok === unitOk[ti].all ? 'phrase-ok' : 'phrase-ng' };
      }
      if (t.ja) return { text: t.text, status: 'ja' };
      if (t.speaker) return { text: t.text, status: 'speaker' };
      if (!t.units.length) return { text: t.text, status: 'none' };
      total++;
      var ok = unitOk[ti].ok === unitOk[ti].all;
      if (ok) correct++;
      return { text: t.text, status: ok ? 'ok' : 'ng', word: true };
    });
    var accuracy = total ? Math.round((correct / total) * 1000) / 10 : 0;
    var res = { accuracy: accuracy, total: total, correct: correct, tokens: out };
    // 合言葉は1語でも聞き取れれば確認できたとみなす（聞き取りミスへの配慮）
    if (pAll) res.phrase = { ok: pOk >= 1, matched: pOk, total: pAll };
    return res;
  }

  function countWords(text) {
    return tokenize(text).filter(function (t) { return !t.space && t.units.length; }).length;
  }

  // 英文の中の話者名（重複なし）
  function speakers(text) {
    var seen = {}, out = [];
    String(text || '').split('\n').forEach(function (l) { if (isJaLine(l)) return; var nm = speakerLabel(l); if (nm && !seen[nm]) { seen[nm] = 1; out.push(nm); } });
    return out;
  }
  var api = { isJaLine: isJaLine, speakers: speakers, score: score, scoreWithPhrase: scoreWithPhrase, phraseTokens: phraseTokens,
    makePhrase: makePhrase, phrasePosition: phrasePosition, tokenize: tokenize, englishOnly: englishOnly, toUnits: toUnits, countWords: countWords,
    numberToWords: numberToWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

/*
 * スタンプの一覧（このアプリ用のオリジナルデザイン）
 *  k：種類 st＝ゆるかわステッカー / hk＝先生のハンコ / pp＝キラキラ・ポップ / lv＝ライブ表彰
 *  rules：自動で押すときの条件（この中からランダムに1つ選ばれます）
 *  絵は js/art.js の Art.design() で描きます。サーバー（Apps Script）にも同じ一覧が入ります。
 */
(function (root) {
  'use strict';
  var L = [
    // ---- はじめて音読したとき ----
    { id: 'st01', k: 'st', sp: 'dog', po: 'wave', ex: 'sparkle', t: 'Welcome!', c: '#ff6b6b', rules: ['first'] },
    { id: 'st02', k: 'st', sp: 'chick', po: 'banzai', ex: 'happy', t: 'はじめの一歩！', c: '#f08c00', rules: ['first'] },
    { id: 'pp01', k: 'pp', sh: 'ribbon', t: 'Nice start!', c1: '#ff8787', c2: '#ffa94d', rules: ['first'] },
    { id: 'hk01', k: 'hk', sh: 'circle', t: 'ようこそ', ink: '#e03131', rot: -8, rules: ['first'] },
    { id: 'st03', k: 'st', sp: 'hamster', po: 'heart', ex: 'happy', t: 'よろしくね！', c: '#e64980', rules: ['first'] },
    // ---- 1週間に3日 ----
    { id: 'st04', k: 'st', sp: 'cat', po: 'wave', ex: 'happy', t: 'Good job!', c: '#f76707', rules: ['week3'] },
    { id: 'st05', k: 'st', sp: 'frog', po: 'banzai', ex: 'happy', t: 'いいね！', c: '#2b8a3e', rules: ['week3'] },
    { id: 'hk02', k: 'hk', sh: 'circle', t: 'Good!', ink: '#e03131', rot: 6, face: 'bear', rules: ['week3'] },
    { id: 'pp02', k: 'pp', sh: 'bubble', t: 'その調子！', c1: '#d0ebff', c2: '#1c7ed6', rules: ['week3'] },
    { id: 'st06', k: 'st', sp: 'shiba', po: 'star', ex: 'sparkle', t: 'Keep going!', c: '#e8590c', rules: ['week3'] },
    // ---- 1週間に5日 ----
    { id: 'st07', k: 'st', sp: 'rabbit', po: 'banzai', ex: 'sparkle', t: 'すごい！', c: '#e64980', rules: ['week5'] },
    { id: 'st08', k: 'st', sp: 'penguin', po: 'heart', ex: 'happy', t: 'Great!', c: '#1971c2', rules: ['week5'] },
    { id: 'pp03', k: 'pp', sh: 'burst', t: 'WOW!', c1: '#fff3bf', c2: '#ff922b', c3: '#d9480f', rules: ['week5'] },
    { id: 'hk03', k: 'hk', sh: 'sakura', t: 'えらい！', ink: '#d6336c', rot: -6, rules: ['week5'] },
    { id: 'st09', k: 'st', sp: 'bear', po: 'star', ex: 'sparkle', t: 'Wonderful!', c: '#9c36b5', rules: ['week5'] },
    // ---- 1週間に7日 ----
    { id: 'pp04', k: 'pp', sh: 'medal', t: 'Perfect/week!', c1: '#7048e8', c2: '#f06595', rules: ['week7'] },
    { id: 'st10', k: 'st', sp: 'panda', po: 'banzai', ex: 'happy', t: '毎日えらい！', c: '#c2255c', rules: ['week7'] },
    { id: 'hk04', k: 'hk', sh: 'rect', t: '皆勤賞', t2: '7日連続', ink: '#c92a2a', rot: 5, rules: ['week7'] },
    { id: 'pp05', k: 'pp', sh: 'star', t: 'Super star!', c1: '#ffe066', c2: '#f08c00', c3: '#e8590c', rules: ['week7'] },
    { id: 'st11', k: 'st', sp: 'cat', po: 'star', ex: 'wink', t: '最強！', c: '#e03131', rules: ['week7'] },
    // ---- 課題を達成したとき ----
    { id: 'hk05', k: 'hk', sh: 'hanamaru', t: 'はなまる', ink: '#e03131', rot: -4, rules: ['achieve'] },
    { id: 'hk06', k: 'hk', sh: 'double', t: 'たいへん', t2: 'よくでき/ました', ink: '#e03131', rot: -7, rules: ['achieve'] },
    { id: 'st12', k: 'st', sp: 'chick', po: 'star', ex: 'sparkle', t: 'Excellent!', c: '#f08c00', rules: ['achieve'] },
    { id: 'pp06', k: 'pp', sh: 'medal', t: 'CLEAR!', c1: '#74c0fc', c2: '#1864ab', rules: ['achieve'] },
    { id: 'st13', k: 'st', sp: 'dog', po: 'heart', ex: 'happy', t: '合格！', c: '#e03131', rules: ['achieve'] },
    { id: 'st14', k: 'st', sp: 'hamster', po: 'banzai', ex: 'wink', t: 'やったね！', c: '#f76707', rules: ['achieve'] },
    // ---- 正確さ100% ----
    { id: 'pp07', k: 'pp', sh: 'burst', t: '100点!', c1: '#fff0f6', c2: '#f06595', c3: '#a61e4d', rules: ['perfect'] },
    { id: 'st15', k: 'st', sp: 'rabbit', po: 'star', ex: 'sparkle', t: '天才！', c: '#7048e8', rules: ['perfect'] },
    { id: 'hk07', k: 'hk', sh: 'hanamaru', t: 'Perfect!', ink: '#e03131', rot: 7, rules: ['perfect'] },
    { id: 'pp08', k: 'pp', sh: 'star', t: '100%!', c1: '#fff3bf', c2: '#fab005', c3: '#e67700', rules: ['perfect'] },
    { id: 'st16', k: 'st', sp: 'shiba', po: 'banzai', ex: 'sparkle', t: 'Amazing!', c: '#d9480f', rules: ['perfect'] },
    // ---- 1週間以上あいてから、また読んだとき ----
    { id: 'st17', k: 'st', sp: 'dog', po: 'wave', ex: 'happy', t: 'おかえり！', c: '#1c7ed6', rules: ['comeback'] },
    { id: 'st18', k: 'st', sp: 'bear', po: 'heart', ex: 'sparkle', t: 'Welcome back!', c: '#e64980', rules: ['comeback'] },
    { id: 'pp09', k: 'pp', sh: 'bubble', t: '待ってたよ！', c1: '#fff0f6', c2: '#e64980', rules: ['comeback'] },
    { id: 'st19', k: 'st', sp: 'penguin', po: 'wave', ex: 'sparkle', t: 'また会えたね', c: '#1971c2', rules: ['comeback'] },
    // ---- 先生が選んで押すとき用（自動では出ません） ----
    { id: 'st20', k: 'st', sp: 'frog', po: 'heart', ex: 'sparkle', t: 'ナイス音読！', c: '#2b8a3e' },
    { id: 'st21', k: 'st', sp: 'cat', po: 'heart', ex: 'sparkle', t: 'Nice voice!', c: '#e64980' },
    { id: 'hk08', k: 'hk', sh: 'circle', t: 'Very good', ink: '#1c7ed6', rot: -5, face: 'cat' },
    { id: 'pp10', k: 'pp', sh: 'ribbon', t: 'がんばったね', c1: '#63e6be', c2: '#20c997' },
    { id: 'st22', k: 'st', sp: 'panda', po: 'star', ex: 'wink', t: '発音◎', c: '#e03131' },
    { id: 'pp11', k: 'pp', sh: 'bubble', t: 'Beautiful!', c1: '#f3f0ff', c2: '#7048e8' },
    { id: 'hk09', k: 'hk', sh: 'sakura', t: 'Excellent', ink: '#e03131', rot: 4 },
    { id: 'st23', k: 'st', sp: 'hamster', po: 'wave', ex: 'happy', t: 'ファイト！', c: '#f76707' },
    { id: 'st24', k: 'st', sp: 'chick', po: 'heart', ex: 'happy', t: 'ありがとう', c: '#e64980' },
    { id: 'pp12', k: 'pp', sh: 'medal', t: 'MVP', c1: '#ffd43b', c2: '#e67700' },
    { id: 'st25', k: 'st', sp: 'heart', po: 'banzai', ex: 'sparkle', t: '大好き！', c: '#e64980' },
    { id: 'st26', k: 'st', sp: 'star', po: 'banzai', ex: 'happy', t: 'キラキラ！', c: '#f08c00' },
    // ---- ライブの表彰 ----
    { id: 'lv1', k: 'lv', rank: 1, t: '優勝!!', t2: 'CHAMPION', live: 'rank1' },
    { id: 'lv2', k: 'lv', rank: 2, t: '準優勝!', t2: 'Fantastic!', live: 'rank2' },
    { id: 'lv3', k: 'lv', rank: 3, t: '3位入賞!', t2: 'Great job!', live: 'rank3' },
    { id: 'lv10', k: 'lv', rank: 10, t: 'TOP 10!', t2: '入賞おめでとう', live: 'top10' }
  ];
  var byId = {};
  L.forEach(function (d) { byId[d.id] = d; });
  function pool(rule) { return L.filter(function (d) { return (d.rules || []).indexOf(rule) >= 0; }); }
  var KINDS = { st: 'ゆるかわ', hk: 'ハンコ', pp: 'キラキラ', lv: 'ライブ表彰' };
  root.StampSet = { list: L, byId: byId, pool: pool, KINDS: KINDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * アバターと着せ替えアイテムの一覧（このアプリ用のオリジナルデザイン）
 *  k：種類 b＝キャラクター / h＝帽子・頭 / f＝顔 / w＝服・持ち物 / bg＝背景
 *  un：もらえる条件
 *    'start'         … 最初から使える
 *    'lv:N'          … 級・段が LEVELS の N 番目以上（1＝9級、2＝8級 … 10＝初段）
 *    'card:N'        … スタンプカードのスタンプが N 個以上
 *    'badge:ID'      … バッジ ID を持っている
 *    'shop:P'        … お店で P ポイントと交換
 *    'live:N'        … ライブで N 位以内に入る
 *  絵は js/art.js の Art.avatar() で描きます。サーバー（Apps Script）にも同じ一覧が入ります。
 */
(function (root) {
  'use strict';
  var L = [
    // ---- キャラクター（最初の10種類） ----
    { id: 'cat', k: 'b', name: 'ねこ', un: 'start' },
    { id: 'dog', k: 'b', name: 'いぬ', un: 'start' },
    { id: 'rabbit', k: 'b', name: 'うさぎ', un: 'start' },
    { id: 'panda', k: 'b', name: 'パンダ', un: 'start' },
    { id: 'hamster', k: 'b', name: 'ハムスター', un: 'start' },
    { id: 'shiba', k: 'b', name: 'しばいぬ', un: 'start' },
    { id: 'chick', k: 'b', name: 'ひよこ', un: 'start' },
    { id: 'penguin', k: 'b', name: 'ペンギン', un: 'start' },
    { id: 'boy', k: 'b', name: '男の子', un: 'start', human: 1 },
    { id: 'girl', k: 'b', name: '女の子', un: 'start', human: 1 },
    // ---- キャラクター（ごほうびで増える） ----
    { id: 'kid2', k: 'b', name: 'くるくる髪の子', un: 'lv:1', human: 1 },
    { id: 'bear', k: 'b', name: 'くま', un: 'lv:2' },
    { id: 'kid3', k: 'b', name: 'おだんご髪の子', un: 'lv:3', human: 1 },
    { id: 'robot', k: 'b', name: 'ロボット', un: 'lv:4' },
    { id: 'ghost', k: 'b', name: 'おばけ', un: 'lv:5' },
    { id: 'alien', k: 'b', name: 'うちゅうじん', un: 'lv:6' },
    { id: 'dragon', k: 'b', name: 'ドラゴン', un: 'lv:7' },
    { id: 'unicorn', k: 'b', name: 'ユニコーン', un: 'lv:8' },
    { id: 'koala', k: 'b', name: 'コアラ', un: 'card:10' },
    { id: 'sheep', k: 'b', name: 'ひつじ', un: 'card:20' },
    { id: 'frog', k: 'b', name: 'かえる', un: 'badge:streak7' },
    { id: 'fox', k: 'b', name: 'きつね', un: 'badge:perfect' },
    { id: 'seal', k: 'b', name: 'アザラシ', un: 'shop:100' },
    { id: 'redpanda', k: 'b', name: 'レッサーパンダ', un: 'shop:150' },
    // ---- 帽子・頭のかざり ----
    { id: 'h_ribbon', k: 'h', name: 'リボン', un: 'start' },
    { id: 'h_cap', k: 'h', name: 'キャップ', un: 'start' },
    { id: 'h_flower', k: 'h', name: '花かんむり', un: 'badge:first' },
    { id: 'h_star', k: 'h', name: '星のヘアピン', un: 'lv:3' },
    { id: 'h_party', k: 'h', name: 'パーティー帽子', un: 'card:10' },
    { id: 'h_phones', k: 'h', name: 'ヘッドホン', un: 'shop:80' },
    { id: 'h_beret', k: 'h', name: 'ベレー帽', un: 'shop:100' },
    { id: 'h_chef', k: 'h', name: 'コック帽', un: 'shop:120' },
    { id: 'h_wizard', k: 'h', name: '魔法使いの帽子', un: 'lv:5' },
    { id: 'h_grad', k: 'h', name: '卒業帽子', un: 'badge:master' },
    { id: 'h_halo', k: 'h', name: '天使のわっか', un: 'badge:perfect10' },
    { id: 'h_crown', k: 'h', name: 'ライブ王者の王冠', un: 'live:1' },
    // ---- 顔 ----
    { id: 'f_glasses', k: 'f', name: 'まるメガネ', un: 'start' },
    { id: 'f_hearts', k: 'f', name: 'ハートのほっぺ', un: 'badge:streak3' },
    { id: 'f_star', k: 'f', name: '星のメガネ', un: 'lv:4' },
    { id: 'f_sun', k: 'f', name: 'サングラス', un: 'shop:60' },
    { id: 'f_mustache', k: 'f', name: 'ちょびひげ', un: 'shop:50' },
    { id: 'f_monocle', k: 'f', name: '片メガネ', un: 'lv:7' },
    // ---- 服・持ち物 ----
    { id: 'w_bowtie', k: 'w', name: '蝶ネクタイ', un: 'start' },
    { id: 'w_tie', k: 'w', name: 'ネクタイ', un: 'lv:1' },
    { id: 'w_book', k: 'w', name: '英語の本', un: 'badge:library5' },
    { id: 'w_mic', k: 'w', name: 'マイク', un: 'badge:recite' },
    { id: 'w_scarf', k: 'w', name: 'マフラー', un: 'card:20' },
    { id: 'w_balloon', k: 'w', name: 'ふうせん', un: 'shop:90' },
    { id: 'w_wand', k: 'w', name: '星のステッキ', un: 'shop:150' },
    { id: 'w_cape', k: 'w', name: 'ヒーローマント', un: 'lv:9' },
    { id: 'w_medal', k: 'w', name: '金メダル', un: 'badge:streak30' },
    { id: 'w_trophy', k: 'w', name: 'ライブのトロフィー', un: 'live:3' },
    // ---- 背景 ----
    { id: 'bg_sky', k: 'bg', name: '青空', un: 'start' },
    { id: 'bg_pink', k: 'bg', name: 'ピンク', un: 'start' },
    { id: 'bg_mint', k: 'bg', name: 'ミント', un: 'start' },
    { id: 'bg_lemon', k: 'bg', name: 'レモン', un: 'start' },
    { id: 'bg_class', k: 'bg', name: '教室', un: 'lv:1' },
    { id: 'bg_rainbow', k: 'bg', name: 'にじ', un: 'badge:words1000' },
    { id: 'bg_sakura', k: 'bg', name: 'さくら', un: 'card:30' },
    { id: 'bg_sea', k: 'bg', name: '海', un: 'shop:120' },
    { id: 'bg_space', k: 'bg', name: '宇宙', un: 'lv:6' },
    { id: 'bg_stage', k: 'bg', name: 'ライブのステージ', un: 'live:10' },
    { id: 'bg_gold', k: 'bg', name: 'チャンピオンの金色', un: 'live:1' }
  ];
  var byId = {};
  L.forEach(function (d) { byId[d.id] = d; });
  var KINDS = { b: 'キャラクター', h: '帽子・頭', f: '顔', w: '服・持ち物', bg: '背景' };
  var SKINS = ['#ffe3cc', '#f6c9a1', '#d9a273', '#9c6644'];
  // 「パーツで作る」の選択肢（[値, 名前]）
  var MAKER = {
    sh: [['round', 'まる'], ['oval', 'たまご'], ['square', 'しかく'], ['wide', 'よこ長']],
    sk: [['#ffe3cc', ''], ['#f6c9a1', ''], ['#d9a273', ''], ['#9c6644', ''], ['#b2f2bb', ''], ['#a5d8ff', ''], ['#d0bfff', ''], ['#ffc9de', '']],
    hs: [['short', 'ショート'], ['spiky', 'ツンツン'], ['bob', 'ボブ'], ['long', 'ロング'], ['curly', 'くるくる'], ['bun', 'おだんご'], ['twin', 'ツインテール'], ['pony', 'ポニーテール'], ['mohawk', 'モヒカン'], ['none', 'なし']],
    hc: [['#2b2118', ''], ['#5c3a1e', ''], ['#a0612b', ''], ['#f2c14e', ''], ['#e8590c', ''], ['#f783ac', ''], ['#4dabf7', ''], ['#40c057', ''], ['#9775fa', ''], ['#f1f3f5', '']],
    ey: [['dot', 'てん'], ['round', 'まる'], ['sparkle', 'キラキラ'], ['happy', 'にっこり'], ['sleepy', 'ねむい'], ['star', 'ほし'], ['wink', 'ウインク']],
    br: [['none', 'なし'], ['normal', 'ふつう'], ['thick', 'ふとい'], ['angry', 'キリッ'], ['worried', 'こまり']],
    mo: [['smile', 'にこ'], ['open', 'あーん'], ['cat', 'ω'], ['tongue', 'ベー'], ['oh', 'お'], ['grin', 'ニカッ']],
    ch: [['pink', 'ピンク'], ['none', 'なし'], ['freckles', 'そばかす'], ['hearts', 'ハート']],
    ea: [['human', 'ひと'], ['cat', 'ねこ'], ['bear', 'くま'], ['rabbit', 'うさぎ'], ['elf', 'エルフ']],
    cl: [['#4dabf7', ''], ['#f783ac', ''], ['#69db7c', ''], ['#ffd43b', ''], ['#ff8787', ''], ['#9775fa', ''], ['#495057', ''], ['#ffffff', '']]
  };
  var MAKER_DEFAULT = { sh: 'round', sk: '#ffe3cc', hs: 'short', hc: '#5c3a1e', ey: 'sparkle', br: 'normal', mo: 'smile', ch: 'pink', ea: 'human', cl: '#4dabf7' };
  root.AvatarSet = { list: L, byId: byId, KINDS: KINDS, SKINS: SKINS, MAKER: MAKER, MAKER_DEFAULT: MAKER_DEFAULT };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * アプリの中心となる処理（サーバー側ロジック）
 * - 本番：Google Apps Script の中で動きます（gas/Code.gs に自動で同梱）
 * - デモ：ブラウザの中で動きます（データは端末内に保存）
 * データの読み書きは「store」を通して行うので、保存先が違っても同じ処理になります。
 */
(function (root) {
  'use strict';
  var Sc = (typeof Scoring !== 'undefined') ? Scoring
    : (typeof require !== 'undefined' ? require('./scoring.js') : null);

  // ---------------- 級・段 ----------------
  var LEVELS = [
    [0, '10級'], [300, '9級'], [700, '8級'], [1200, '7級'], [2000, '6級'], [3000, '5級'],
    [4500, '4級'], [6500, '3級'], [9000, '2級'], [12000, '1級'], [16000, '初段'],
    [21000, '二段'], [27000, '三段'], [34000, '四段'], [42000, '五段'], [51000, '六段'],
    [61000, '七段'], [72000, '八段'], [84000, '九段'], [100000, '十段'], [130000, '名人']
  ];
  function levelOf(words) {
    var idx = 0;
    for (var i = 0; i < LEVELS.length; i++) if (words >= LEVELS[i][0]) idx = i;
    var next = LEVELS[idx + 1];
    return {
      name: LEVELS[idx][1], index: idx,
      next: next ? next[1] : null, nextAt: next ? next[0] : null,
      from: LEVELS[idx][0],
      progress: next ? Math.min(1, (words - LEVELS[idx][0]) / (next[0] - LEVELS[idx][0])) : 1
    };
  }

  // ---------------- 日付（日本時間） ----------------
  function jstDate(d) {
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekStart(dateStr) { // 月曜始まり
    var d = new Date(dateStr + 'T00:00:00Z');
    var dow = (d.getUTCDay() + 6) % 7;
    return addDays(dateStr, -dow);
  }
  function monthStart(dateStr) { return dateStr.slice(0, 8) + '01'; }

  // ---------------- ごほうび（バッジ・先生スタンプ・着せ替え） ----------------
  // hidden: true … 「ひみつのバッジ」（取るまで条件がわからない）
  var BADGES = [
    { id: 'first', icon: '🌱', name: 'はじめの一歩', desc: 'はじめて音読した' },
    { id: 'streak3', icon: '🔥', name: '3日連続', desc: '3日続けて音読した' },
    { id: 'streak7', icon: '🔥', name: '1週間連続', desc: '7日続けて音読した' },
    { id: 'streak30', icon: '🏅', name: '30日連続', desc: '30日続けて音読した' },
    { id: 'perfect', icon: '💯', name: 'パーフェクト', desc: '正確さ100%を出した' },
    { id: 'perfect10', icon: '💎', name: 'パーフェクト10', desc: '正確さ100%を10回出した' },
    { id: 'words1000', icon: '📘', name: '1000語', desc: '累計1000語を読んだ' },
    { id: 'words10000', icon: '📚', name: '1万語', desc: '累計1万語を読んだ' },
    { id: 'assign', icon: '✅', name: '課題クリア', desc: '課題を達成した' },
    { id: 'master', icon: '🎓', name: '音読マスター', desc: 'マスターモードをクリアした' },
    { id: 'recite', icon: '🧠', name: '暗唱チャレンジ', desc: '英文を隠したまま合格した' },
    { id: 'recite10', icon: '🧠', name: '暗唱名人', desc: '英文を隠したまま10回合格した' },
    { id: 'trans', icon: '🔄', name: '日本語→英語', desc: '⑤日本語→英語に合格した' },
    { id: 'trans10', icon: '🌏', name: '通訳名人', desc: '⑤日本語→英語に10回合格した' },
    { id: 'library5', icon: '📖', name: 'ライブラリ5', desc: 'ライブラリの英文を5本読んだ' },
    { id: 'library20', icon: '🏛', name: 'ライブラリ20', desc: 'ライブラリの英文を20本読んだ' },
    { id: 'repeat', icon: '🔁', name: 'リピート完走', desc: 'リピート練習を最後までやった' },
    { id: 'stamp10', icon: '🎫', name: 'スタンプカード', desc: 'スタンプカードを1枚うめた' },
    { id: 'omikuji', icon: '🎲', name: 'おみくじ', desc: 'おみくじ英文を読んだ' },
    { id: 'teacher', icon: '💌', name: '先生からのスタンプ', desc: '先生からスタンプをもらった' },
    { id: 'early', icon: '🌅', name: '早起き音読', desc: '朝7時より前に音読した', hidden: true },
    { id: 'daikichi', icon: '🎊', name: '大吉', desc: 'おみくじ英文を読んで、大吉を引いた', hidden: true },
    { id: 'proverb7', icon: '🍀', name: 'ことわざ好き', desc: 'ことわざを7回読んだ', hidden: true },
    { id: 'marathon', icon: '🏃', name: '1日1000語', desc: '1日に1000語読んだ', hidden: true },
    { id: 'five', icon: '✋', name: '1日5回', desc: '1日に5回音読した', hidden: true },
    { id: 'weekend', icon: '🗓', name: '週末も音読', desc: '土曜と日曜の両方で音読した', hidden: true },
    { id: 'comeback', icon: '🌈', name: 'おかえり', desc: '1週間以上あいてから、また音読した', hidden: true },
    { id: 'alltypes', icon: '🎨', name: '全種類制覇', desc: '1つの課題で①〜⑤すべてに合格した', hidden: true },
    { id: 'shodan', icon: '🥋', name: '初段', desc: '初段になった', hidden: true }
  ];
  // 条件を満たすと自動で押される「先生スタンプ」（a：動物、t：スタンプの言葉）
  var STAMP_RULES = [
    { id: 'first', a: 'dog', t: 'Welcome!', name: 'はじめて音読したとき' },
    { id: 'week3', a: 'cat', t: 'Good job!', name: '1週間に3日読んだとき' },
    { id: 'week5', a: 'rabbit', t: 'Great!', name: '1週間に5日読んだとき' },
    { id: 'week7', a: 'bear', t: 'Perfect week!', name: '1週間に7日読んだとき' },
    { id: 'achieve', a: 'chick', t: 'Excellent!', name: '課題を達成したとき' },
    { id: 'perfect', a: 'panda', t: 'Wonderful!', name: '正確さ100%を出したとき（週1回まで）' },
    { id: 'comeback', a: 'dog', t: 'Welcome back!', name: '1週間以上あいてから、また読んだとき' }
  ];
  // ライブの表彰スタンプ（最初から入っているもの。col：色、cr：王冠）
  var LIVE_STAMPS = {
    rank1: { g: 'lv1', t: '優勝!!', name: 'ライブ1位' },
    rank2: { g: 'lv2', t: '準優勝!', name: 'ライブ2位' },
    rank3: { g: 'lv3', t: '3位入賞!', name: 'ライブ3位' },
    top10: { g: 'lv10', t: 'TOP 10!', name: 'ライブ10位以内' }
  };
  // スタンプの絵の一覧（js/stamps.js）
  function SS() { return root.StampSet || { list: [], byId: {}, pool: function () { return []; } }; }
  var STAMP_ANIMALS = ['cat', 'rabbit', 'bear', 'dog', 'panda', 'chick', 'penguin', 'frog', 'hamster', 'shiba', 'star', 'heart', 'boy', 'girl', 'kid2', 'kid3', 'robot', 'ghost', 'dragon', 'alien', 'unicorn'];
  var STAMP_POSES = ['banzai', 'wave', 'heart', 'star'], STAMP_EXPRS = ['sparkle', 'happy', 'wink'];
  // 条件ごとの絵の中からランダムに1つ（最近もらった絵はなるべく避ける）
  function pickDesign(list, ach) {
    if (!list.length) return null;
    var recent = ((ach && ach.st) || []).slice(-6).map(function (x) { return x.g; });
    var cand = list.filter(function (d) { return recent.indexOf(d.id) < 0; });
    if (!cand.length) cand = list;
    return cand[Math.floor(Math.random() * cand.length)];
  }
  var MAX_STAMP_IMAGE = 45000;   // 画像スタンプのデータの上限（文字数）
  // 着せ替え（級・段で解放）lv：LEVELSの番号
  var THEMES = [
    { id: 'blue', name: 'ブルー', lv: 0 }, { id: 'sakura', name: 'さくら', lv: 2 }, { id: 'mint', name: 'ミント', lv: 4 },
    { id: 'sunset', name: 'ゆうやけ', lv: 6 }, { id: 'lavender', name: 'ラベンダー', lv: 8 }, { id: 'ocean', name: 'オーシャン', lv: 10 },
    { id: 'gold', name: 'ゴールド', lv: 12 }, { id: 'night', name: 'ナイト', lv: 14 }
  ];
  var LEVEL_ICONS = ['🐣', '🐥', '🐤', '🐦', '🕊', '🦜', '🦉', '🦢', '🦩', '🦚', '🦅', '🐬', '🐳', '🦄', '🐉', '🦁', '🐯', '🦊', '🐼', '🐨', '👑'];
  var CARD_ICONS = ['🌸', '🍀', '⭐', '🌈', '🎈', '🍩', '🍉', '🎵', '🍓', '🌻', '🍰', '🚀', '🎁', '🌙', '🍦', '🧸', '🎀', '🪐', '🐠', '🏆'];
  function iconsUnlocked(levelIdx, days) {
    var list = LEVEL_ICONS.slice(0, levelIdx + 1);
    return list.concat(CARD_ICONS.slice(0, Math.min(CARD_ICONS.length, Math.floor(days / 10))));
  }

  // ---------------- ユーティリティ ----------------
  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'はい' || v === 'ON'; }
  function splitClasses(v) { return str(v).split(/[,、\s]+/).filter(Boolean); }
  function displayName(s, allowNick) {
    if (allowNick && str(s.nick)) return str(s.nick);
    return s.cls + ' ' + s.no + '番';
  }
  function studentPublic(s) {
    var lv = levelOf(num(s.totalWords));
    return {
      id: s.id, cls: s.cls, no: s.no, name: str(s.name), nick: str(s.nick),
      totalWords: num(s.totalWords), streak: num(s.streak), bestStreak: num(s.bestStreak),
      lastDate: str(s.lastDate), todayWords: num(s.todayWords), todayDate: str(s.todayDate),
      level: lv
    };
  }
  // ごほうびのデータ（生徒シートの「実績データ」列にJSONで保存）
  function achOf(s) {
    var o;
    try { o = JSON.parse(str(s.ach) || '{}'); } catch (e) { o = {}; }
    if (!o || typeof o !== 'object') o = {};
    o.b = o.b || {}; o.c = o.c || {}; o.lib = o.lib || []; o.st = o.st || []; o.sk = o.sk || {};
    o.p = num(o.p); o.d = num(o.d); o.ps = num(o.ps); o.own = o.own || []; o.sn = o.sn || [];
    return o;
  }
  // ---------------- アバター ----------------
  function AV() { return root.AvatarSet || { list: [], byId: {}, SKINS: [] }; }
  function itemUnlocked(it, ach, s) {
    var un = str(it.un), n = num(un.split(':')[1]);
    if (un === 'start' || ach.own.indexOf(it.id) >= 0) return true;
    if (un.indexOf('lv:') === 0) return levelOf(num(s.totalWords)).index >= n;
    if (un.indexOf('card:') === 0) return num(ach.d) >= n;
    if (un.indexOf('badge:') === 0) return !!ach.b[un.slice(6)];
    return ach.own.indexOf(it.id) >= 0;   // shop / live
  }
  function unlockedItems(ach, s) { return AV().list.filter(function (it) { return itemUnlocked(it, ach, s); }).map(function (it) { return it.id; }); }
  // mode：'self'（本人）/ 'teacher'（先生：確認待ちの画像もそのまま）/ 'others'（ほかの生徒：確認前の画像は代わりのアバター）
  function avatarOf(ach, mode) {
    var av = ach.av && ach.av.b ? ach.av : null;
    if (!av || av.b !== 'pic') return av;
    var pk = ach.pk || {}, out = { b: 'pic', pic: str(pk.id), st: str(pk.st), bg: av.bg || '' };
    if (mode === 'self' || mode === 'teacher') { if (av.fb) out.fb = av.fb; return out; }
    if (pk.st === 'ok' && pk.id) return { b: 'pic', pic: str(pk.id), bg: av.bg || '' };
    return av.fb || null;
  }
  var MAX_PIC = 32000;   // 絵・画像のアバターの大きさの上限（文字数）
  function pendingPics(store, me) {
    return store.getStudents().filter(function (s) { var a = achOf(s); return a.pk && a.pk.st === 'p' && (!me || canTeach(me, s.cls)); });
  }
  function availPoints(ach) { return Math.max(0, num(ach.p) - num(ach.ps)); }
  // ライブの表彰でもらえるアイテム
  function liveItems(rank) {
    return AV().list.filter(function (it) { var un = str(it.un); return un.indexOf('live:') === 0 && rank <= num(un.slice(5)); }).map(function (it) { return it.id; });
  }
  function rewardsPublic(ach, s, today, store) {
    var lv = levelOf(num(s.totalWords)), unl = unlockedItems(ach, s);
    return { points: ach.p, badges: ach.b, days: ach.d, stampedToday: ach.ld === today, theme: ach.th || 'blue', icon: ach.ic || '',
      weekDays: ach.wk === weekStart(today) ? num(ach.wd) : 0, read: ach.lib, counts: ach.c,
      stamps: ach.st.slice(-40), newStamps: ach.st.filter(function (x) { return x.n; }).length,
      icons: iconsUnlocked(lv.index, ach.d), levelIndex: lv.index, stampImgs: stampImgs(store, ach.st.slice(-40)),
      av: avatarOf(ach, 'self'), own: ach.own, picRejected: !!ach.pr, lastMk: ach.mkl || null, pk: ach.pk && ach.pk.st !== 'x' ? ach.pk : null, unlocked: unl, spent: num(ach.ps), avail: availPoints(ach),
      newItems: ach.av && ach.av.b ? unl.filter(function (id) { return ach.sn.indexOf(id) < 0 && str((AV().byId[id] || {}).un) !== 'start'; }) : [] };
  }
  function stampRulesOn(store) {
    var v = str(store.getSetting('自動スタンプ'));
    if (!v) return STAMP_RULES.map(function (r) { return r.id; });
    if (v === 'なし') return [];
    return v.split(/[,、\s]+/).filter(Boolean);
  }
  // ---- 先生が作ったスタンプ ----
  function customStamps(store) { return store.getStamps ? store.getStamps().filter(function (x) { return str(x.id); }) : []; }
  function stampPublic(d) {
    var a = str(d.animal).split(':');
    return { id: str(d.id), kind: str(d.kind) === 'image' ? 'image' : 'art', animal: a[0] || 'cat', pose: a[1] || 'banzai', expr: a[2] || 'sparkle', text: str(d.text),
      color: str(d.color), image: str(d.image), owner: str(d.owner), created: str(d.created) };
  }
  // 生徒の記録に入れるスタンプの形（a：絵、t：言葉、col：色、cr：王冠、c：画像スタンプのID）
  function stampEntry(def) {
    if (!def) return null;
    if (def.g) return { g: str(def.g), t: str(def.t) };
    if (def.k && def.id) return { g: str(def.id), t: str(def.t).replace(/\//g, '') };   // 絵の一覧のスタンプ
    if (str(def.kind) === 'image') return { c: str(def.id), t: str(def.text) };
    var parts = str(def.animal || def.a).split(':');
    var o = { a: parts[0] || 'cat', t: str(def.text || def.t) };
    if (parts[1]) o.po = parts[1];
    if (parts[2]) o.ex = parts[2];
    var col = str(def.color || def.col); if (col) o.col = col;
    if (def.cr) o.cr = 1;
    return o;
  }
  // key：'c:<先生スタンプのID>' / 'r:<自動スタンプの種類>' / 'l:<ライブの表彰>'
  function findStampDef(store, key) {
    key = str(key);
    if (key.indexOf('c:') === 0) {
      var id = key.slice(2);
      return customStamps(store).filter(function (x) { return str(x.id) === id; })[0] || null;
    }
    if (key.indexOf('r:') === 0) {
      var rule = STAMP_RULES.filter(function (x) { return x.id === key.slice(2); })[0];
      return rule ? (pickDesign(SS().pool(rule.id)) || rule) : null;
    }
    if (key.indexOf('l:') === 0) return LIVE_STAMPS[key.slice(2)] || null;
    if (key.indexOf('g:') === 0) return SS().byId[key.slice(2)] || null;
    if (key === 'rand:') return pickDesign(SS().list.filter(function (d) { return d.k !== 'lv'; }));
    return null;
  }
  // 画像スタンプの絵（表示に使われる分だけ送る）
  function stampImgs(store, list) {
    var need = {}, out = {};
    (list || []).forEach(function (x) { if (x && x.c) need[x.c] = 1; });
    if (!store || !Object.keys(need).length) return out;
    customStamps(store).forEach(function (d) { if (need[str(d.id)] && str(d.image)) out[str(d.id)] = str(d.image); });
    return out;
  }
  function autoStampArt(store) {
    try { var o = JSON.parse(str(store.getSetting('自動スタンプの絵')) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }
  // スタンプを生徒に押す（ach を書き換えて JSON を返す）
  function pushStamp(s, entry, rule, today, by) {
    var ach = achOf(s), e = {};
    for (var k in entry) e[k] = entry[k];
    e.r = rule; e.d = today; e.n = 1; if (by) e.by = str(by).slice(0, 20);
    ach.st.push(e);
    if (!ach.b.teacher) ach.b.teacher = today;
    if (ach.st.length > 60) ach.st = ach.st.slice(-60);
    return JSON.stringify(ach);
  }
  // 何人分もまとめて書き込む
  function updateStudents(store, ups) {
    if (!ups.length) return;
    if (store.updateStudents) store.updateStudents(ups);
    else ups.forEach(function (u) { store.updateStudent(u.id, u.f); });
  }

  // 現在の日時（日本時間 'YYYY-MM-DDTHH:MM'）。処理のたびに handle() で設定
  var NOW_STR = '';
  function isScheduled(a) { return !!str(a.start) && str(a.start).slice(0, 16) > NOW_STR; }
  function assignmentVisibleTo(a, s, today) {
    if (!bool(a.published)) return false;
    if (isScheduled(a)) return false;   // 予約配信（開始日時より前）は見えない
    var cl = splitClasses(a.classes);
    return !cl.length || cl.indexOf('全員') >= 0 || cl.indexOf(s.cls) >= 0;
  }

  // ---------------- 音読の種類 ----------------
  // 1：通常 / 2：（　　）穴埋め / 3：スペースなし / 4：並べ替え / 5：日本語→英語
  var MAX_TEXT = 10000;   // 課題の英文・和訳の上限（文字数）
  var TYPE_NAME = { 1: '通常', 2: '穴埋め', 3: 'スペースなし', 4: '並べ替え', 5: '日本語→英語' };
  var NEED_JA = [4, 5];   // 日本語が必要な種類
  function aTypes(a) {
    var t = str(a.types).split(/[,\s]+/).map(Number).filter(function (x) { return x >= 1 && x <= 5; });
    t = t.filter(function (x, i) { return t.indexOf(x) === i; }).sort();
    return t.length ? t : [1];
  }
  function isMaster(a) { return str(a.mode) === 'master'; }
  function passLine(a) { var v = num(a.pass); return v >= 1 && v <= 100 ? v : 80; }
  function bestKey(aid, type) { return type > 1 ? aid + '~' + type : aid; }
  // 生徒ごとの、種類別の自己ベストとマスター達成状況
  // 合格ラインを何回超えれば達成か（1〜20回）
  function passNeed(a) { var v = Math.round(num(a.passCount)); return v >= 1 && v <= 20 ? v : 1; }
  // 合格した回数（旧データは自己ベストが合格ライン以上なら1回とみなす）
  function passesOf(b, pl) {
    if (!b) return 0;
    if (b.passes !== undefined && b.passes !== null && b.passes !== '') return num(b.passes);
    return num(b.best) >= pl ? 1 : 0;
  }
  // 達成の判定
  //  通常音読：どの種類でもよいので、合格の合計回数が「合格回数」に達したら達成
  //  マスター：チェックした種類のそれぞれで「合格回数」に達したら達成
  function progress(store, sid, a) {
    var types = aTypes(a), bests = {}, passes = {}, attempts = 0, cleared = 0, total = 0, pl = passLine(a), need = passNeed(a);
    types.forEach(function (t) {
      var b = store.getBest(sid, bestKey(a.id, t));
      bests[t] = b ? num(b.best) : null;
      passes[t] = passesOf(b, pl);
      total += passes[t];
      attempts += b ? num(b.attempts) : 0;
      if (passes[t] >= need) cleared++;
    });
    var master = isMaster(a);
    var achieved = master ? cleared === types.length : total >= need;
    return { types: types, bests: bests, passes: passes, totalPasses: total, need: need, attempts: attempts, master: master, pass: pl,
      clearedSteps: cleared, achieved: achieved, masterCleared: master && achieved };
  }

  // ---------------- トークン ----------------
  function makeToken(ctx, payload) {
    var body = ctx.b64(JSON.stringify(payload));
    return body + '.' + ctx.sign(body);
  }
  function readToken(ctx, token, role) {
    if (!token || typeof token !== 'string' || token.indexOf('.') < 0) throw err('ログインしてください。');
    var parts = token.split('.');
    if (ctx.sign(parts[0]) !== parts[1]) throw err('ログインの有効期限が切れました。もう一度ログインしてください。');
    var p = JSON.parse(ctx.unb64(parts[0]));
    if (p.exp < ctx.now().getTime()) throw err('ログインの有効期限が切れました。もう一度ログインしてください。');
    if (role && p.role !== role) throw err('この操作はできません。');
    return p;
  }

  // ログイン失敗の回数制限（5回失敗で10分ロック）
  function checkLock(ctx, key) {
    var n = num(ctx.cacheGet('fail:' + key));
    if (n >= 5) throw err('パスコードを何度もまちがえたため、10分間ログインできません。');
  }
  function addFail(ctx, key) {
    var n = num(ctx.cacheGet('fail:' + key)) + 1;
    ctx.cachePut('fail:' + key, String(n), 600);
  }

  // ---------------- パスワードのハッシュ（SHA-256） ----------------
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), result = '', words = [], i, j;
    var bytes = unescape(encodeURIComponent(ascii));
    var bitLen = bytes.length * 8;
    var hash = [], k = [], primeCounter = 0, isComposite = {};
    for (var cand = 2; primeCounter < 64; cand++) {
      if (!isComposite[cand]) {
        for (i = 0; i < 313; i += cand) isComposite[i] = cand;
        hash[primeCounter] = (Math.pow(cand, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    bytes += '\x80';
    while (bytes.length % 64 - 56) bytes += '\x00';
    for (i = 0; i < bytes.length; i++) {
      j = bytes.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  function hashPass(id, pass) { return 'h:' + sha256(String(id).toLowerCase() + ':' + pass + ':ondoku-v1'); }
  function passMatches(t, pass) {
    var stored = str(t.pass);
    if (!stored || !pass) return false;
    return stored.indexOf('h:') === 0 ? stored === hashPass(t.id, pass) : stored === pass;
  }
  function randomPass() {
    var c = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < 8; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }

  // ---------------- 先生・クラス ----------------
  function teacherPublic(t) {
    return { id: t.id, name: str(t.name), admin: str(t.role) === 'admin', role: str(t.role) === 'admin' ? 'admin' : 'teacher',
      classes: splitClasses(t.classes), active: t.active === undefined || t.active === '' ? true : bool(t.active) };
  }
  // 旧版（先生パスワード1つ）からの移行：先生が1人もいなければ管理者を作る
  function ensureAdmin(store) {
    if (store.getTeachers().length) return;
    var legacy = str(store.getSetting('先生パスワード'));
    if (!legacy) return;
    store.addTeacher({ id: 'admin', name: '管理者', pass: hashPass('admin', legacy), role: 'admin', classes: '', active: true, created: '' });
  }
  function classList(store) {
    var map = {}, order = [];
    store.getClasses().forEach(function (c) { if (str(c.name) && !map[c.name]) { map[c.name] = { name: str(c.name), count: num(c.count), students: 0 }; order.push(c.name); } });
    store.getStudents().forEach(function (s) {
      if (!map[s.cls]) { map[s.cls] = { name: s.cls, count: 0, students: 0 }; order.push(s.cls); }
      map[s.cls].students++;
    });
    return order.map(function (n) { return map[n]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
  }
  function canTeach(me, cls) { return me.admin || me.classes.indexOf(cls) >= 0; }
  // 課題を編集できるか：管理者／作った先生／同じクラスの担当
  function canEditAssignment(me, a) {
    if (me.admin) return true;
    if (str(a.owner) === me.id) return true;
    var cl = splitClasses(a.classes);
    if (!cl.length || cl.indexOf('全員') >= 0) return false;
    return cl.some(function (c) { return me.classes.indexOf(c) >= 0; });
  }

  // ---------------- 処理本体 ----------------
  var handlers = {};

  handlers.publicInfo = function (p, store) {
    return {
      appTitle: str(store.getSetting('アプリ名')),
      classes: classList(store).filter(function (c) { return c.students > 0; }).map(function (c) { return c.name; })
    };
  };

  handlers.studentLogin = function (p, store, ctx) {
    var id = str(p.cls) + '-' + str(p.no);
    checkLock(ctx, id);
    var s = store.getStudent(id);
    if (!s || str(s.pass) !== str(p.pass)) {
      addFail(ctx, id);
      throw err('クラス・番号・パスコードのどれかがちがいます。');
    }
    var days = num(store.getSetting('ログイン有効日数')) || 30;
    var token = makeToken(ctx, { role: 'student', id: id, exp: ctx.now().getTime() + days * 86400000 });
    // ホームのデータもいっしょに返す（ログイン直後の読み込みを1回減らす）
    var home = null;
    try { home = handlers.home({ token: token }, store, ctx); } catch (e) { home = null; }
    return { token: token, student: studentPublic(s), home: home };
  };

  handlers.teacherLogin = function (p, store, ctx) {
    ensureAdmin(store);
    var id = str(p.id).toLowerCase() || 'admin';
    checkLock(ctx, 'teacher:' + id);
    var t = store.getTeacher(id);
    if (!t || !teacherPublic(t).active || !passMatches(t, str(p.pass))) {
      addFail(ctx, 'teacher:' + id);
      throw err('ログインIDかパスワードがちがいます。');
    }
    if (str(t.pass).indexOf('h:') !== 0) store.updateTeacher(t.id, { pass: hashPass(t.id, str(p.pass)) });
    var token = makeToken(ctx, { role: 'teacher', id: t.id, exp: ctx.now().getTime() + 7 * 86400000 });
    return { token: token, me: teacherPublic(t) };
  };

  function currentStudent(p, store, ctx) {
    var t = readToken(ctx, p.token, 'student');
    var s = store.getStudent(t.id);
    if (!s) throw err('名簿にありません。先生に確認してください。');
    return s;
  }

  // 未設定（空欄）のときは既定値を使う
  function boolDef(v, def) { return (v === '' || v === null || v === undefined) ? def : bool(v); }
  function settingsForClient(store) {
    return {
      allowNick: bool(store.getSetting('ニックネームを使う')),
      showRanking: bool(store.getSetting('ランキングを表示')),
      appTitle: str(store.getSetting('アプリ名')),
      phraseCheck: boolDef(store.getSetting('合言葉チェック'), true),
      saveAudio: boolDef(store.getSetting('音声を保存'), true),
      autoStamps: stampRulesOn(store)
    };
  }
  // 不正の判定
  //  definite: true  … 不正がはっきりしている → 自動で無効（先生への通知なし）
  //  definite: false … はっきりしない → 記録を保留し、先生が録音を聞いて確認
  var FLAGS = {
    tts: { label: 'お手本音声を検知', definite: true },
    phrase: { label: '合言葉なし', definite: true },
    partial: { label: '合言葉が一部しか聞き取れない', definite: false },
    speed: { label: '読む速さが不自然に速い', definite: false }
  };
  var AUTO_INVALID = '自動で無効';

  handlers.home = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var today = jstDate(ctx.now());
    var list = store.getAssignments().filter(function (a) { return assignmentVisibleTo(a, s, today); })
      .map(function (a) {
        var pg = progress(store, s.id, a);
        var b = store.getBest(s.id, a.id);
        return {
          id: a.id, title: a.title, due: str(a.due), contest: bool(a.contest), words: num(a.words),
          created: str(a.created), best: b ? num(b.best) : null, attempts: pg.attempts,
          types: pg.types, bests: pg.bests, master: pg.master, pass: pg.pass,
          clearedSteps: pg.clearedSteps, masterCleared: pg.masterCleared,
          achieved: pg.achieved, totalPasses: pg.totalPasses, need: pg.need, folder: str(a.folder),
          detail: assignmentDetail(a, b, pg) // 課題を開いたときにすぐ表示できるよう、本文などもいっしょに送る
        };
      });
    list.sort(function (x, y) { return (y.created || '').localeCompare(x.created || ''); });
    var used = {};
    list.forEach(function (a) { if (a.folder) used[a.folder] = 1; });
    var folders = foldersFor(store, used), fm = folderMap(folders);
    list.forEach(function (a) { if (a.folder && !fm[a.folder]) a.folder = ''; }); // 消えたフォルダ → その他
    var pub = studentPublic(s);
    if (pub.todayDate !== today) pub.todayWords = 0;
    if (pub.lastDate && pub.lastDate < addDays(today, -1)) pub.streak = 0;
    return { student: pub, assignments: list, folders: folders, settings: settingsForClient(store), today: today, rewards: rewardsPublic(achOf(s), s, today, store), live: liveForStudent(store, s, ctx.now()) };
  };

  handlers.getAssignment = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a || !assignmentVisibleTo(a, s)) throw err('この課題は見つかりません。');
    return assignmentDetail(a, store.getBest(s.id, a.id), progress(store, s.id, a));
  };
  function assignmentDetail(a, b, pg) {
    return {
      assignment: { id: a.id, title: a.title, text: a.text, ja: str(a.ja), due: str(a.due), contest: bool(a.contest),
        types: pg.types, mode: isMaster(a) ? 'master' : 'normal', pass: pg.pass, blanks: str(a.blanks) },
      best: b ? num(b.best) : null, attempts: pg.attempts, progress: pg
    };
  }

  // 録音の保存だけを先に行う（Apps Script では、順番待ちのロックの前に呼ばれる）
  function audioOk(cfg, p) { return cfg.saveAudio && p.audio && p.audio.b64 && String(p.audio.b64).length < 4000000; }
  function preSubmit(p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    if (!store.saveAudio || !audioOk(settingsForClient(store), p)) return;
    var la = p.aid ? store.getAssignment(str(p.aid)) : null;
    if (la && liveRunning(store, s, ctx.now(), la.id)) { delete p.audio; return; }   // ライブ中の音読は録音を保存しない
    var id = store.saveAudio({ mime: str(p.audio.mime).slice(0, 60) || 'audio/webm', b64: String(p.audio.b64),
      name: s.id + '_' + ctx.now().toISOString().replace(/[:.]/g, '-') });
    if (id) { p._audioId = String(id); delete p.audio; }
  }

  handlers.submit = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var now = ctx.now(), today = jstDate(now);
    var text, aid = str(p.aid), kind, type = 1, a = null;
    if (aid) {
      a = store.getAssignment(aid);
      if (!a || !assignmentVisibleTo(a, s)) throw err('この課題は見つかりません。');
      type = num(p.type) || 1;
      if (aTypes(a).indexOf(type) < 0) throw err('この課題では、その音読の種類は選べません。');
      text = a.text; kind = (bool(a.contest) ? '大会' : '課題') + (type > 1 ? '（' + TYPE_NAME[type] + '）' : '');
    } else {
      text = str(p.text).slice(0, MAX_TEXT);
      if (!text) throw err('英文がありません。');
      kind = { proverb: 'ことわざ', library: 'ライブラリ', omikuji: 'おみくじ', repeat: 'リピート' }[p.kind] || '自主練';
    }
    var transcript = str(p.transcript).slice(0, 6000);
    var cfg = settingsForClient(store);
    var hasPhrase = !!str(p.phrase);
    var r = hasPhrase ? Sc.scoreWithPhrase(text, transcript, str(p.phrase).slice(0, 60), num(p.phraseAt)) : Sc.score(text, transcript);
    var dur = Math.max(0, Math.min(3600, num(p.duration)));

    // 不正防止：お手本音声の検知、合言葉の確認
    var flag = (p.flag === 'tts' || p.flag === 'phrase') ? p.flag : '';
    if (!flag && cfg.phraseCheck) {
      if (!hasPhrase || !r.phrase || r.phrase.matched === 0) flag = 'phrase';   // 合言葉がまったくない → 録音などの可能性が高い
      // 合言葉は1語でも聞き取れれば合格（scoring.js）。'partial' は旧版との互換のために残しています
      else if (!r.phrase.ok) flag = 'partial';
    }
    // 1秒に4語を超える速さ（15語以上）は、人の音読としては不自然 → 先生が確認
    if (!flag && r.correct >= 15 && dur > 0 && r.correct / dur > 4) flag = 'speed';

    // ---- ライブ中の音読：ライブのポイントだけに使う ----
    // 記録シート・累計単語数・級・課題のベスト・ランキング・ごほうびには入れない（スプレッドシートには何も書かない）
    var liveNow = a ? liveRunning(store, s, now, a.id) : null;
    if (liveNow) {
      var liveResult = null;
      if (!flag && r.correct > 0) {
        var sc = liveScores(store, liveNow), le = sc[s.id] || { p: 0, c: 0, b: 0, t: '' }, gained = Math.round(r.accuracy);
        le = { p: num(le.p) + gained, c: num(le.c) + 1, b: Math.max(num(le.b), r.accuracy), t: now.toISOString() };
        sc[s.id] = le;
        setLiveScore(store, liveNow, s.id, le, sc);
        var order = liveOrder(sc), rank = order.indexOf(s.id) + 1;
        liveResult = { id: str(liveNow.id), title: str(liveNow.title), gained: gained, points: le.p, count: le.c, rank: rank, total: order.length };
      }
      if (flag) return { flagged: flag, definite: true, result: r, student: studentPublic(s), liveOnly: true };
      return { result: r, student: studentPublic(s), live: liveResult, liveOnly: true, newBadges: [], newStamps: [], bonus: 0, pointsGained: 0,
        rewards: rewardsPublic(achOf(s), s, today, store) };
    }

    // 音声の保存（先生が確認できるように）
    var audioId = str(p._audioId);
    if (!audioId && audioOk(cfg, p) && store.saveAudio) {
      try {
        audioId = store.saveAudio({ mime: str(p.audio.mime).slice(0, 60) || 'audio/webm', b64: String(p.audio.b64),
          name: s.id + '_' + now.toISOString().replace(/[:.]/g, '-') });
      } catch (e) { audioId = ''; }
    }

    if (flag) {
      // 記録には残すが、単語数・自己ベストには加えない
      store.appendRecord({
        time: now.toISOString(), date: today, sid: s.id, aid: aid, type: type, kind: kind, flag: FLAGS[flag].label,
        reviewed: FLAGS[flag].definite ? AUTO_INVALID : '',
        accuracy: r.accuracy, correct: 0, total: r.total, duration: dur, audio: audioId,
        transcript: transcript.slice(0, 1000), text: aid ? '' : text.slice(0, 300)
      });
      return { flagged: flag, definite: FLAGS[flag].definite, result: r, student: studentPublic(s) };
    }

    // 生徒の累計を更新
    var before = levelOf(num(s.totalWords));
    var prevLast = str(s.lastDate), firstToday = r.correct > 0 && prevLast !== today;
    var upd = {};
    upd.totalWords = num(s.totalWords) + r.correct;
    if (r.correct > 0) {
      if (str(s.lastDate) === today) upd.streak = num(s.streak) || 1;
      else if (str(s.lastDate) === addDays(today, -1)) upd.streak = num(s.streak) + 1;
      else upd.streak = 1;
      upd.lastDate = today;
      upd.bestStreak = Math.max(num(s.bestStreak), upd.streak);
    }
    upd.todayWords = (str(s.todayDate) === today ? num(s.todayWords) : 0) + r.correct;
    upd.todayDate = today;
    for (var k in upd) s[k] = upd[k];
    var after = levelOf(num(s.totalWords));

    var newBest = false, before2 = a ? progress(store, s.id, a) : null;
    if (aid) {
      var bk = bestKey(aid, type);
      var b = store.getBest(s.id, bk);
      if (!b || r.accuracy > num(b.best)) newBest = true;
      store.setBest(s.id, bk, {
        best: b ? Math.max(num(b.best), r.accuracy) : r.accuracy,
        attempts: (b ? num(b.attempts) : 0) + 1,
        passes: passesOf(b, passLine(a)) + (r.accuracy >= passLine(a) ? 1 : 0),
        last: now.toISOString(),
        bestAt: newBest ? now.toISOString() : (b ? b.bestAt : now.toISOString())
      });
    }
    store.appendRecord({
      time: now.toISOString(), date: today, sid: s.id, aid: aid, type: type, kind: kind,
      accuracy: r.accuracy, correct: r.correct, total: r.total, duration: dur, audio: audioId, flag: '',
      transcript: transcript.slice(0, 1000), text: aid ? '' : text.slice(0, 300)
    });
    var after2 = a ? progress(store, s.id, a) : null;
    var achievedNew = !!(after2 && after2.achieved && !before2.achieved);
    var masterNew = !!(after2 && after2.masterCleared && !before2.masterCleared);

    // ---- ごほうび（バッジ・ポイント・スタンプカード・先生スタンプ） ----
    var ach = achOf(s), c = ach.c, newBadges = [], newStamps = [], bonus = 0, ws = weekStart(today);
    var firstEver = !ach.b.first && num(s.totalWords) - r.correct <= 0;
    // スタンプカード・今週の日数（その日の最初の音読で1つ）
    var newDay = r.correct > 0 && ach.ld !== today;
    if (newDay) {
      ach.d += 1; ach.ld = today;
      if (ach.wk !== ws) { ach.wk = ws; ach.wd = 0; }
      ach.wd = num(ach.wd) + 1;
    }
    if (ach.td !== today) { ach.td = today; ach.tn = 0; }
    ach.tn = num(ach.tn) + 1;
    function inc(key) { c[key] = num(c[key]) + 1; }
    if (p.kind === 'proverb' && !aid) inc('pv');
    if (p.kind === 'omikuji' && !aid) inc('om');
    if (p.kind === 'repeat' && !aid) inc('rp');
    if (p.kind === 'library' && !aid) {
      var lid = str(p.libId).replace(/[^\w-]/g, '').slice(0, 30);
      if (lid && ach.lib.indexOf(lid) < 0) { ach.lib.push(lid); if (ach.lib.length > 300) ach.lib.shift(); }
    }
    if (r.accuracy >= 100) inc('pf');
    // 暗唱（英文を隠して読む）・⑤日本語→英語の合格でボーナスポイント
    var thr = a ? passLine(a) : 80;
    var recite = bool(p.recite) && type !== 5, trans = !!a && type === 5;
    if ((recite || trans) && r.accuracy >= thr && r.correct > 0) {
      bonus = r.correct; ach.p += bonus;
      inc(recite ? 'rc' : 'tr');
    }
    function award(id, cond) { if (cond && !ach.b[id]) { ach.b[id] = today; newBadges.push(id); } }
    award('first', true);
    award('streak3', num(s.streak) >= 3); award('streak7', num(s.streak) >= 7); award('streak30', num(s.streak) >= 30);
    award('perfect', num(c.pf) >= 1); award('perfect10', num(c.pf) >= 10);
    award('words1000', num(s.totalWords) >= 1000); award('words10000', num(s.totalWords) >= 10000);
    award('assign', !!(after2 && after2.achieved)); award('master', !!(after2 && after2.masterCleared));
    award('recite', num(c.rc) >= 1); award('recite10', num(c.rc) >= 10);
    award('trans', num(c.tr) >= 1); award('trans10', num(c.tr) >= 10);
    award('library5', ach.lib.length >= 5); award('library20', ach.lib.length >= 20);
    award('repeat', num(c.rp) >= 1); award('stamp10', ach.d >= 10); award('omikuji', num(c.om) >= 1);
    var hour = (now.getUTCHours() + 9) % 24;
    award('early', r.correct > 0 && hour >= 4 && hour < 7);
    // おみくじ：英文を読んだあとに引く。よく読めるほど大吉が出やすい
    var fortune = p.kind === 'omikuji' && !aid && r.correct > 0 ? drawFortune(r.accuracy) : '';
    award('daikichi', fortune === '大吉');
    award('proverb7', num(c.pv) >= 7);
    award('marathon', num(s.todayWords) >= 1000);
    award('five', ach.tn >= 5);
    var dow = new Date(today + 'T00:00:00Z').getUTCDay();
    if (dow === 6 && r.correct > 0) ach.sat = today;
    award('weekend', dow === 0 && r.correct > 0 && ach.sat === addDays(today, -1));
    var comeback = firstToday && !!prevLast && prevLast < addDays(today, -7);
    award('comeback', comeback);
    award('alltypes', !!(after2 && after2.types.length === 5 && after2.types.every(function (t) { return after2.passes[t] >= 1; })));
    award('shodan', after.index >= 10);
    // 先生スタンプ（条件を満たすと自動で押す。同じ条件では1回だけ）
    var on = stampRulesOn(store), art = autoStampArt(store);
    function stamp(ruleId, key, cond) {
      if (!cond || on.indexOf(ruleId) < 0 || ach.sk[key]) return;
      var rule = STAMP_RULES.filter(function (x) { return x.id === ruleId; })[0];
      ach.sk[key] = 1;
      // 先生が作ったスタンプが選ばれていれば、そちらを押す
      var e = (art[ruleId] && stampEntry(findStampDef(store, 'c:' + art[ruleId]))) || stampEntry(pickDesign(SS().pool(ruleId), ach)) || { a: rule.a, t: rule.t };
      e.r = ruleId;
      var rec = {}; for (var k in e) rec[k] = e[k];
      rec.d = today; rec.n = 1;
      ach.st.push(rec); newStamps.push(e);
    }
    stamp('first', 'first', firstEver && r.correct > 0);
    stamp('week3', 'w3:' + ws, newDay && ach.wd === 3);
    stamp('week5', 'w5:' + ws, newDay && ach.wd === 5);
    stamp('week7', 'w7:' + ws, newDay && ach.wd === 7);
    stamp('achieve', 'a:' + aid, achievedNew);
    stamp('perfect', 'pf:' + ws, r.accuracy >= 100);
    stamp('comeback', 'cb:' + today, comeback);
    award('teacher', ach.st.length >= 1);
    // ポイント（お店で使える）：毎日の最初の音読 +10、バッジ1つ +20、課題達成 +30
    var gain = (newDay ? 10 : 0) + newBadges.length * 20 + (achievedNew ? 30 : 0);
    ach.p += gain;
    // 古い記録を整理（データが大きくなりすぎないように）
    if (ach.st.length > 60) ach.st = ach.st.slice(-60);
    var sk = Object.keys(ach.sk);
    if (sk.length > 150) sk.slice(0, sk.length - 150).forEach(function (x) { delete ach.sk[x]; });
    upd.ach = JSON.stringify(ach); s.ach = upd.ach;
    store.updateStudent(s.id, upd);

    return {
      progress: after2, masterNew: masterNew, achievedNew: achievedNew,
      passed: a ? r.accuracy >= passLine(a) : null,
      result: r, student: studentPublic(s), newBest: newBest,
      levelUp: after.index > before.index ? after.name : null,
      newBadges: newBadges, newStamps: newStamps, bonus: bonus, rewards: rewardsPublic(ach, s, today, store),
      pointsGained: gain + bonus, fortune: fortune || undefined
    };
  };
  // おみくじの運勢（正確さが高いほど大吉・中吉が出やすい）
  var FORTUNE_ODDS = [[95, [50, 30, 15, 5]], [85, [30, 35, 25, 10]], [70, [15, 30, 30, 25]], [0, [5, 20, 35, 40]]];
  var FORTUNE_NAMES = ['大吉', '中吉', '小吉', '吉'];
  function drawFortune(acc) {
    var odds = FORTUNE_ODDS.filter(function (o) { return acc >= o[0]; })[0][1], x = Math.random() * 100;
    for (var i = 0, sum = 0; i < odds.length; i++) { sum += odds[i]; if (x < sum) return FORTUNE_NAMES[i]; }
    return '吉';
  }

  handlers.ranking = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    if (!bool(store.getSetting('ランキングを表示'))) throw err('ランキングは先生が非表示にしています。');
    var allowNick = bool(store.getSetting('ニックネームを使う'));
    var today = jstDate(ctx.now());
    var period = p.period === 'week' || p.period === 'month' ? p.period : 'total';
    var scope = p.scope === 'all' ? 'all' : 'class';
    var students = store.getStudents().filter(function (x) { return scope === 'all' || x.cls === s.cls; });
    var score = {};
    if (period === 'total') {
      students.forEach(function (x) { score[x.id] = num(x.totalWords); });
    } else {
      var since = period === 'week' ? weekStart(today) : monthStart(today);
      store.getRecordsSince(since).forEach(function (r) { score[r.sid] = (score[r.sid] || 0) + num(r.correct); });
    }
    var list = students.map(function (x) {
      return { id: x.id, name: displayName(x, allowNick), words: score[x.id] || 0, level: levelOf(num(x.totalWords)).name, av: avatarOf(achOf(x), x.id === s.id ? 'self' : 'others') };
    }).sort(function (a, b) { return b.words - a.words; });
    var rank = 0, prev = -1, mine = null;
    list.forEach(function (x, i) {
      if (x.words !== prev) { rank = i + 1; prev = x.words; }
      x.rank = rank;
      x.me = x.id === s.id;
      if (x.me) mine = { rank: x.rank, words: x.words };
    });
    var top = list.slice(0, 30).map(function (x) { return { rank: x.rank, name: x.name, words: x.words, level: x.level, me: x.me, av: x.av }; });
    if (mine) mine.av = avatarOf(achOf(s), 'self');
    return { list: top, mine: mine, count: list.length, period: period, scope: scope };
  };

  handlers.contest = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a || !assignmentVisibleTo(a, s) || !bool(a.contest)) throw err('この大会は見つかりません。');
    var allowNick = bool(store.getSetting('ニックネームを使う'));
    var byId = {};
    store.getStudents().forEach(function (x) { byId[x.id] = x; });
    var list = store.getBestsByAssignment(a.id).filter(function (b) { return byId[b.sid]; })
      .map(function (b) { return { sid: b.sid, name: displayName(byId[b.sid], allowNick), best: num(b.best), at: str(b.bestAt), av: avatarOf(achOf(byId[b.sid]), b.sid === s.id ? 'self' : 'others') }; })
      .sort(function (x, y) { return y.best - x.best || x.at.localeCompare(y.at); });
    var mine = null;
    list.forEach(function (x, i) {
      x.rank = (i > 0 && list[i - 1].best === x.best) ? list[i - 1].rank : i + 1;
      x.me = x.sid === s.id;
      if (x.me) mine = { rank: x.rank, best: x.best };
    });
    return {
      title: a.title, due: str(a.due), mine: mine, count: list.length,
      list: list.slice(0, 30).map(function (x) { return { rank: x.rank, name: x.name, best: x.best, me: x.me, av: x.av }; })
    };
  };

  handlers.history = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var titles = {};
    store.getAssignments().forEach(function (a) { titles[a.id] = a.title; });
    var recs = store.getRecordsByStudent(s.id, 50).map(function (r) {
      return {
        time: r.time, date: r.date, kind: r.kind, title: r.aid ? (titles[r.aid] || '（削除された課題）') : (Sc.englishOnly(r.text).replace(/\n/g, ' ') || str(r.text)).slice(0, 40),
        accuracy: num(r.accuracy), correct: num(r.correct), total: num(r.total)
      };
    });
    // 直近14日の単語数
    var today = jstDate(ctx.now()), days = [];
    var map = {};
    store.getRecordsByStudent(s.id, 2000).forEach(function (r) {
      if (r.date >= addDays(today, -13)) map[r.date] = (map[r.date] || 0) + num(r.correct);
    });
    for (var i = 13; i >= 0; i--) { var d = addDays(today, -i); days.push({ date: d, words: map[d] || 0 }); }
    return { records: recs, days: days };
  };

  // ---- 着せ替え（テーマ色・アイコン） ----
  handlers.setLook = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var ach = achOf(s), lv = levelOf(num(s.totalWords));
    if (p.theme !== undefined) {
      var th = THEMES.filter(function (t) { return t.id === p.theme; })[0];
      if (!th) throw err('そのテーマはありません。');
      if (lv.index < th.lv) throw err('そのテーマは「' + LEVELS[th.lv][1] + '」になると使えます。');
      ach.th = th.id;
    }
    if (p.icon !== undefined) {
      var ic = str(p.icon);
      if (ic && iconsUnlocked(lv.index, ach.d).indexOf(ic) < 0) throw err('そのアイコンはまだ使えません。');
      ach.ic = ic;
    }
    store.updateStudent(s.id, { ach: JSON.stringify(ach) });
    return { theme: ach.th || 'blue', icon: ach.ic || '' };
  };
  // ---- 届いた先生スタンプを「見た」にする ----
  // アバターを決める・着せ替える
  handlers.setAvatar = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx), ach = achOf(s), v = p.av || {}, A = AV();
    var first = !(ach.av && ach.av.b), out = {};
    // 前は最初から使えたキャラクター（ロボットなど）を使っていた人は、そのまま持ち続けられる
    var curB = ach.av ? (ach.av.b === 'pic' ? ach.av.fb && ach.av.fb.b : ach.av.b) : '';
    if (curB && A.byId[curB] && A.byId[curB].k === 'b' && !itemUnlocked(A.byId[curB], ach, s)) ach.own.push(curB);
    function pick(kind, id, required) {
      id = str(id);
      if (!id) { if (required) throw err('キャラクターを選んでください。'); return; }
      var it = A.byId[id];
      if (!it || it.k !== kind) throw err('そのアイテムはありません。');
      if (!itemUnlocked(it, ach, s)) throw err('「' + it.name + '」はまだ使えません。');
      out[kind] = id;
    }
    if (v.b === 'maker' || v.b === 'pic') { var vb = v.b; v = JSON.parse(JSON.stringify(v)); v.b = vb; }
    var M = A.MAKER || {};
    if (v.b === 'maker') {
      // パーツで作ったキャラクター
      out.b = 'maker'; out.mk = {};
      Object.keys(M).forEach(function (k) {
        var val = str((v.mk || {})[k]), okv = M[k].some(function (x) { return x[0] === val; });
        out.mk[k] = okv ? val : (A.MAKER_DEFAULT || {})[k];
      });
    } else if (v.b === 'pic') {
      // 絵・画像のアバター（アップロードした最新の1つだけ）
      if (!ach.pk || !ach.pk.id || ach.pk.st === 'x') throw err('絵や画像のアバターがありません。もう一度作ってください。');
      out.b = 'pic'; out.fb = (ach.av && ach.av.fb) || (ach.av && ach.av.b && ach.av.b !== 'pic' ? ach.av : { b: 'cat' });
    } else pick('b', v.b, true);
    if (v.b !== 'pic') { pick('h', v.h); pick('f', v.f); pick('w', v.w); }
    pick('bg', v.bg);
    var sk = Math.round(num(v.sk)); if (out.b !== 'maker' && out.b !== 'pic' && sk > 0 && sk < (A.SKINS || []).length) out.sk = sk;
    ach.av = out;
    if (out.b === 'maker') ach.mkl = out.mk;
    if (first) ach.sn = unlockedItems(ach, s);   // 最初に選んだときは、今あるアイテムを「見た」ことにする
    s.ach = JSON.stringify(ach);
    store.updateStudent(s.id, { ach: s.ach });
    return { rewards: rewardsPublic(ach, s, jstDate(ctx.now()), store) };
  };
  // お店：ポイントでアイテムと交換
  handlers.buyItem = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx), ach = achOf(s), it = AV().byId[str(p.id)];
    if (!it || str(it.un).indexOf('shop:') !== 0) throw err('そのアイテムはお店にありません。');
    if (ach.own.indexOf(it.id) >= 0) throw err('もう持っています。');
    var price = num(str(it.un).slice(5));
    if (availPoints(ach) < price) throw err('ポイントが足りません。（あと ' + (price - availPoints(ach)) + 'pt）');
    ach.own.push(it.id); ach.ps = num(ach.ps) + price; ach.sn.push(it.id);
    s.ach = JSON.stringify(ach);
    store.updateStudent(s.id, { ach: s.ach });
    return { rewards: rewardsPublic(ach, s, jstDate(ctx.now()), store) };
  };
  handlers.seenItems = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx), ach = achOf(s);
    ach.sn = unlockedItems(ach, s); delete ach.pr;
    store.updateStudent(s.id, { ach: JSON.stringify(ach) });
    return {};
  };
  // 絵・画像のアバターを送る（先生が確認するまで、ほかの人には見えない）
  handlers.uploadAvatarPic = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx), ach = achOf(s), img = str(p.image);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(img)) throw err('画像が正しくありません。');
    if (img.length > MAX_PIC) throw err('画像が大きすぎます。');
    if (!store.addPic) throw err('この機能は使えません。');
    store.getPics().filter(function (x) { return str(x.sid) === s.id; }).forEach(function (x) { store.deletePic(str(x.id)); });
    var id = 'P' + ctx.now().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    store.addPic({ id: id, sid: s.id, image: img, kind: p.kind === 'draw' ? 'draw' : 'photo', status: 'p', created: ctx.now().toISOString(), reviewed: '' });
    var prev = ach.av && ach.av.b && ach.av.b !== 'pic' ? ach.av : (ach.av && ach.av.fb) || { b: 'cat' };
    ach.pk = { id: id, st: 'p' };
    ach.av = { b: 'pic', bg: (ach.av && ach.av.bg) || 'bg_sky', fb: prev };
    delete ach.pr;
    s.ach = JSON.stringify(ach);
    store.updateStudent(s.id, { ach: s.ach });
    return { rewards: rewardsPublic(ach, s, jstDate(ctx.now()), store) };
  };
  // 絵・画像のデータ（本人と先生は確認前でも見られる。ほかの生徒は先生がOKしたものだけ）
  handlers.avatarPics = function (p, store, ctx) {
    var tk = readToken(ctx, p.token, null), teacher = tk.role === 'teacher', want = {}, out = {};
    [].concat(p.ids || []).slice(0, 80).forEach(function (id) { want[str(id)] = 1; });
    if (store.getPics) store.getPics().forEach(function (x) {
      var id = str(x.id);
      if (!want[id]) return;
      if (teacher || str(x.status) === 'ok' || str(x.sid) === tk.id) out[id] = str(x.image);
    });
    return { pics: out };
  };
  handlers.t_pics = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), byId = {};
    pendingPics(store, me).forEach(function (s) { byId[achOf(s).pk.id] = s; });
    var list = (store.getPics ? store.getPics() : []).filter(function (x) { return byId[str(x.id)]; }).map(function (x) {
      var s = byId[str(x.id)];
      return { id: str(x.id), sid: s.id, cls: s.cls, no: s.no, name: str(s.name), kind: str(x.kind), image: str(x.image), created: str(x.created) };
    });
    return { list: list };
  };
  handlers.t_reviewPic = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), id = str(p.id);
    var row = (store.getPics ? store.getPics() : []).filter(function (x) { return str(x.id) === id; })[0];
    if (!row) throw err('見つかりません。');
    var s = store.getStudent(str(row.sid));
    if (!s || !canTeach(me, s.cls)) throw err('担当クラスの生徒ではありません。');
    var ach = achOf(s), ok = !!p.ok;
    store.updatePic(id, { status: ok ? 'ok' : 'x', reviewed: ctx.now().toISOString() + ' ' + me.name });
    if (ach.pk && ach.pk.id === id) {
      ach.pk.st = ok ? 'ok' : 'x';
      if (!ok) { if (ach.av && ach.av.b === 'pic') ach.av = ach.av.fb || { b: 'cat' }; ach.pr = 1; }
      store.updateStudent(s.id, { ach: JSON.stringify(ach) });
    }
    return {};
  };
  handlers.seenStamps = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var ach = achOf(s), changed = false;
    ach.st.forEach(function (x) { if (x.n) { delete x.n; changed = true; } });
    if (changed) store.updateStudent(s.id, { ach: JSON.stringify(ach) });
    return {};
  };
  // ---- 英文ライブラリ（先生が追加したもの・非表示にしたもの） ----
  function libraryHidden(store) { return str(store.getSetting('ライブラリ非表示')).split(',').filter(Boolean); }
  function libPublic(x) { return { id: str(x.id), level: num(x.level) || 1, title: str(x.title), text: str(x.text), ja: str(x.ja), cat: '先生から' }; }
  handlers.library = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    return { custom: (store.getLibrary ? store.getLibrary() : []).map(libPublic), hidden: libraryHidden(store), read: achOf(s).lib };
  };
  handlers.t_library = function (p, store, ctx) {
    currentTeacher(p, store, ctx);
    return { custom: (store.getLibrary ? store.getLibrary() : []).map(function (x) { var o = libPublic(x); o.owner = str(x.owner); return o; }), hidden: libraryHidden(store) };
  };
  handlers.t_saveLibrary = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var it = p.item || {};
    var title = str(it.title).slice(0, 80), text = str(it.text), lv = Math.round(num(it.level));
    if (!title) throw err('タイトルを入力してください。');
    if (!text || !Sc.countWords(text)) throw err('英文を入力してください。');
    if (text.length > 3000 || str(it.ja).length > 3000) throw err('ライブラリの英文・和訳は3000文字以内にしてください。');
    if (lv < 1 || lv > 4) lv = 1;
    var data = { level: lv, title: title, text: text, ja: str(it.ja) };
    if (it.id) {
      var cur = store.getLibrary().filter(function (x) { return str(x.id) === str(it.id); })[0];
      if (!cur) throw err('見つかりません。');
      store.updateLibrary(str(it.id), data);
      return { id: str(it.id) };
    }
    var id = 'c' + ctx.now().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    data.id = id; data.owner = me.id; data.created = ctx.now().toISOString();
    store.addLibrary(data);
    return { id: id };
  };
  handlers.t_deleteLibrary = function (p, store, ctx) {
    currentTeacher(p, store, ctx);
    store.deleteLibrary(str(p.id));
    return {};
  };
  handlers.t_hideLibrary = function (p, store, ctx) {
    currentTeacher(p, store, ctx);
    var id = str(p.id).replace(/[^\w-]/g, ''), list = libraryHidden(store).filter(function (x) { return x !== id; });
    if (p.hidden) list.push(id);
    store.setSetting('ライブラリ非表示', list.join(','));
    return { hidden: list };
  };

  handlers.setNick = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    if (!bool(store.getSetting('ニックネームを使う'))) throw err('ニックネームは使えない設定です。');
    var nick = str(p.nick).replace(/[<>&"'\\]/g, '').slice(0, 10);
    store.updateStudent(s.id, { nick: nick });
    return { nick: nick };
  };

  // ---------------- 先生用 ----------------
  // ログイン中の先生（毎回、名簿で有効かを確認）
  function currentTeacher(p, store, ctx) {
    var tk = readToken(ctx, p.token, 'teacher');
    var t = store.getTeacher(tk.id);
    if (!t || !teacherPublic(t).active) throw err('ログインしてください。（アカウントが無効になっています）');
    return teacherPublic(t);
  }
  function adminOnly(me) { if (!me.admin) throw err('この操作は管理者だけができます。'); }

  handlers.t_overview = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var today = jstDate(ctx.now());
    var students = store.getStudents();
    var bests = store.getAllBests();
    var tname = {};
    store.getTeachers().forEach(function (t) { tname[t.id] = str(t.name); });
    var assignments = store.getAssignments().map(function (a) {
      var cl = splitClasses(a.classes);
      var targets = students.filter(function (s) { return !cl.length || cl.indexOf('全員') >= 0 || cl.indexOf(s.cls) >= 0; });
      var tset = {};
      targets.forEach(function (s) { tset[s.id] = true; });
      var done = 0, sum = 0;
      bests.forEach(function (b) { if (b.aid === a.id && tset[b.sid]) { done++; sum += num(b.best); } });
      var achievedN = 0, startedN = 0;
      targets.forEach(function (s) { var pg = progress(store, s.id, a); if (pg.achieved) achievedN++; if (pg.attempts > 0) startedN++; });
      var avg = done ? Math.round(sum / done * 10) / 10 : null;
      done = startedN;
      return {
        id: a.id, title: a.title, classes: str(a.classes), due: str(a.due), contest: bool(a.contest),
        published: bool(a.published), created: str(a.created), words: num(a.words),
        types: aTypes(a), mode: isMaster(a) ? 'master' : 'normal',
        owner: str(a.owner), ownerName: tname[str(a.owner)] || '', canEdit: canEditAssignment(me, a),
        start: str(a.start), scheduled: isScheduled(a), achieved: achievedN,
        mine: str(a.owner) === me.id || splitClasses(a.classes).some(function (c) { return me.classes.indexOf(c) >= 0; }),
        targets: targets.length, done: done, avg: avg, passCount: passNeed(a), folder: str(a.folder)
      };
    }).sort(function (x, y) { return (y.created || '').localeCompare(x.created || ''); });
    var weekSince = weekStart(today);
    var week = {}, flags = {};
    store.getRecordsSince(weekSince).forEach(function (r) {
      week[r.sid] = (week[r.sid] || 0) + num(r.correct);
      if (str(r.flag)) flags[r.sid] = (flags[r.sid] || 0) + 1;
    });
    var list = students.map(function (s) {
      var pub = studentPublic(s);
      pub.name = str(s.name);
      pub.weekWords = week[s.id] || 0;
      pub.weekFlags = flags[s.id] || 0;
      pub.av = avatarOf(achOf(s), 'teacher');
      if (pub.lastDate && pub.lastDate < addDays(today, -1)) pub.streak = 0;
      return pub;
    });
    var settings = settingsForClient(store);
    return { assignments: assignments, students: list, classes: classList(store).map(function (c) { return c.name; }), today: today, settings: settings,
      openFlags: openFlags(store, today) + pendingPics(store, me).length, me: me,
      folders: folderList(store).map(function (f) { return folderPublic(f, me, tname); }) };
  };

  handlers.t_getAssignment = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a) throw err('課題が見つかりません。');
    return { assignment: {
      id: a.id, title: a.title, text: a.text, ja: str(a.ja), classes: str(a.classes),
      due: str(a.due), contest: bool(a.contest), published: bool(a.published),
      types: aTypes(a), mode: isMaster(a) ? 'master' : 'normal', pass: passLine(a), passCount: passNeed(a), blanks: str(a.blanks),
      start: str(a.start), canEdit: canEditAssignment(me, a), folder: str(a.folder)
    } };
  };

  handlers.t_saveAssignment = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var a = p.assignment || {};
    var title = str(a.title).slice(0, 80), text = str(a.text);
    if (!title) throw err('タイトルを入力してください。');
    if (!text) throw err('英文を入力してください。');
    // 長すぎる英文・和訳は切り捨てずにエラーにする（気づかないうちに消えないように）
    if (text.length > MAX_TEXT) throw err('英文が長すぎます（' + text.length + '文字）。' + MAX_TEXT + '文字以内にしてください。');
    if (str(a.ja).length > MAX_TEXT) throw err('和訳が長すぎます（' + str(a.ja).length + '文字）。' + MAX_TEXT + '文字以内にしてください。');
    var data = {
      title: title, text: text, ja: str(a.ja), classes: splitClasses(a.classes).join(','),
      due: str(a.due).slice(0, 10), contest: !!a.contest, published: a.published !== false,
      words: Sc.countWords(text)
    };
    var types = aTypes({ types: [].concat(a.types || [1]).join(',') });
    data.mode = a.mode === 'master' ? 'master' : 'normal';
    var hasJa = Sc.tokenize(text).some(function (t) { return t.ja; }) || !!data.ja;
    if (!hasJa && types.some(function (t) { return NEED_JA.indexOf(t) >= 0; })) {
      throw err('「並べ替え」と「日本語→英語」には日本語が必要です。英文に日本語の行を入れるか、和訳を入力してください。');
    }
    data.types = types.join(',');
    data.pass = Math.max(1, Math.min(100, Math.round(num(a.pass) || 80)));
    data.passCount = Math.max(1, Math.min(20, Math.round(num(a.passCount) || 1)));
    data.blanks = str(a.blanks).replace(/[^\d,]/g, '').slice(0, 8000);
    data.start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str(a.start)) ? str(a.start).slice(0, 16) : '';
    if (data.start && data.due && data.due < data.start.slice(0, 10)) throw err('締切が開始日時より前になっています。');
    if (a.folder !== undefined) data.folder = folderMap(folderList(store))[str(a.folder)] ? str(a.folder) : '';
    // 権限：担当クラスにだけ出せる（全員向けは管理者のみ）
    var cls = splitClasses(data.classes);
    if (!me.admin) {
      if (!cls.length) throw err('対象クラスを選んでください（全員向けの課題は管理者だけが出せます）。');
      var bad = cls.filter(function (c) { return me.classes.indexOf(c) < 0; });
      if (bad.length) throw err('担当していないクラスには課題を出せません：' + bad.join('、'));
    }
    if (a.id && store.getAssignment(a.id)) {
      if (!canEditAssignment(me, store.getAssignment(a.id))) throw err('この課題を編集する権限がありません。');
      store.updateAssignment(a.id, data);
      return { id: a.id };
    }
    data.owner = me.id;
    do { data.id = 'A' + ctx.now().getTime().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
    while (store.getAssignment(data.id));
    data.created = ctx.now().toISOString();
    store.addAssignment(data);
    return { id: data.id };
  };

  handlers.t_deleteAssignment = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var da = store.getAssignment(str(p.aid));
    if (da && !canEditAssignment(me, da)) throw err('この課題を削除する権限がありません。');
    store.deleteAssignment(str(p.aid));
    return {};
  };

  // ================= 課題フォルダ =================
  // いちばん上のフォルダ（例：教材A）の中に、サブフォルダを3階層まで作れる（合わせて4階層）
  var FOLDER_DEPTH = 4;
  var DEPTH_MSG = 'フォルダは、いちばん上のフォルダの中に3階層までしか作れません。';
  function folderList(store) { return store.getFolders ? store.getFolders() : []; }
  function folderMap(list) { var m = {}; list.forEach(function (f) { m[str(f.id)] = f; }); return m; }
  function folderDepth(m, id) { var d = 0, seen = {}; id = str(id); while (id && m[id] && !seen[id]) { seen[id] = 1; d++; id = str(m[id].parent); } return d; }
  function folderHeight(list, id, seen) {
    seen = seen || {}; if (seen[id]) return 0; seen[id] = 1;
    return 1 + list.filter(function (f) { return str(f.parent) === id; })
      .reduce(function (mx, k) { return Math.max(mx, folderHeight(list, str(k.id), seen)); }, 0);
  }
  function folderUnder(m, id, anc) { var seen = {}; id = str(id); while (id && m[id] && !seen[id]) { if (id === anc) return true; seen[id] = 1; id = str(m[id].parent); } return false; }
  function folderCanEdit(me, f) { return !!(me.admin || str(f.owner) === me.id); }
  function folderPublic(f, me, tname) {
    var o = { id: str(f.id), name: str(f.name), parent: str(f.parent) };
    if (me) { o.owner = str(f.owner); o.ownerName = (tname && tname[o.owner]) || ''; o.canEdit = folderCanEdit(me, f); }
    return o;
  }
  // 生徒に見せるフォルダ：見える課題が入っているフォルダと、その上のフォルダだけ
  function foldersFor(store, used) {
    var list = folderList(store), m = folderMap(list), need = {};
    Object.keys(used).forEach(function (id) { var seen = {}; while (id && m[id] && !seen[id]) { seen[id] = need[id] = 1; id = str(m[id].parent); } });
    return list.filter(function (f) { return need[str(f.id)]; }).map(function (f) { return folderPublic(f); });
  }
  function moveFolder(store, me, list, m, id, parent) {
    var cur = m[id];
    if (!cur) throw err('フォルダが見つかりません。');
    if (!folderCanEdit(me, cur)) throw err('「' + str(cur.name) + '」フォルダを変更する権限がありません（作った先生か管理者だけが変更できます）。');
    if (parent && !m[parent]) throw err('移動先のフォルダが見つかりません。');
    if (parent === id || folderUnder(m, parent, id)) throw err('フォルダを、そのフォルダ自身の中には移動できません。');
    if (folderDepth(m, parent) + folderHeight(list, id) > FOLDER_DEPTH) throw err(DEPTH_MSG);
    var name = str(cur.name);
    if (list.some(function (x) { return str(x.parent) === parent && str(x.name) === name && str(x.id) !== id; })) throw err('移動先に同じ名前のフォルダ「' + name + '」があります。');
    store.updateFolder(id, { parent: parent });
    cur.parent = parent;
  }

  handlers.t_saveFolder = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var f = p.folder || {}, id = str(f.id), name = str(f.name).replace(/\s+/g, ' ').trim().slice(0, 40), parent = str(f.parent);
    if (!name) throw err('フォルダの名前を入力してください。');
    var list = folderList(store), m = folderMap(list);
    if (parent && !m[parent]) throw err('入れる先のフォルダが見つかりません。');
    if (list.some(function (x) { return str(x.parent) === parent && str(x.name) === name && str(x.id) !== id; })) throw err('同じ場所に「' + name + '」フォルダがすでにあります。');
    if (id) {
      if (!m[id]) throw err('フォルダが見つかりません。');
      if (!folderCanEdit(me, m[id])) throw err('このフォルダを変更する権限がありません（作った先生か管理者だけが変更できます）。');
      if (parent !== str(m[id].parent)) moveFolder(store, me, list, m, id, parent);
      store.updateFolder(id, { name: name });
      return { id: id };
    }
    if (folderDepth(m, parent) + 1 > FOLDER_DEPTH) throw err(DEPTH_MSG);
    do { id = 'F' + ctx.now().getTime().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); } while (m[id]);
    store.addFolder({ id: id, name: name, parent: parent, owner: me.id, created: ctx.now().toISOString() });
    return { id: id };
  };

  // フォルダを消す：中の課題とサブフォルダは、ひとつ上のフォルダへ出す（課題は消えない）
  handlers.t_deleteFolder = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var id = str(p.fid), list = folderList(store), m = folderMap(list), f = m[id];
    if (!f) throw err('フォルダが見つかりません。');
    if (!folderCanEdit(me, f)) throw err('このフォルダを削除する権限がありません（作った先生か管理者だけが削除できます）。');
    var up = str(f.parent), movedA = 0, movedF = 0;
    store.getAssignments().forEach(function (a) { if (str(a.folder) === id) { store.updateAssignment(a.id, { folder: up }); movedA++; } });
    list.forEach(function (x) {
      if (str(x.parent) !== id) return;
      var nm = str(x.name), dup = list.some(function (y) { return y !== x && str(y.parent) === up && str(y.name) === nm; });
      store.updateFolder(str(x.id), dup ? { parent: up, name: (nm + '（' + str(f.name) + '）').slice(0, 40) } : { parent: up }); movedF++;
    });
    store.deleteFolder(id);
    return { movedAssignments: movedA, movedFolders: movedF };
  };

  // まとめて移動（課題 aids と フォルダ fids を、folder の中へ。folder が空なら「その他（フォルダなし）」へ）
  handlers.t_moveToFolder = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var to = str(p.folder), list = folderList(store), m = folderMap(list);
    if (to && !m[to]) throw err('移動先のフォルダが見つかりません。');
    var moved = 0, skipped = [];
    [].concat(p.aids || []).slice(0, 500).forEach(function (aid) {
      var a = store.getAssignment(str(aid)); if (!a) return;
      if (!canEditAssignment(me, a)) { skipped.push(str(a.title)); return; }
      if (str(a.folder) !== to) { store.updateAssignment(a.id, { folder: to }); }
      moved++;
    });
    [].concat(p.fids || []).slice(0, 100).forEach(function (fid) {
      fid = str(fid); if (!m[fid] || str(m[fid].parent) === to) return;
      moveFolder(store, me, list, m, fid, to); moved++;
    });
    return { moved: moved, skipped: skipped };
  };

  // 課題の音読記録の集計（全回の平均・合計時間）。無効になった記録（不正・未確認）は数えない
  function validRecord(r) { return !str(r.flag) || /^問題なし/.test(str(r.reviewed)); }
  function recordStats(store, aidSet) {
    var st = {};
    store.getRecordsSince('').forEach(function (r) {
      var aid = str(r.aid);
      if (!aid || (aidSet && !aidSet[aid]) || !validRecord(r)) return;
      var k = r.sid + '|' + aid, x = st[k] || (st[k] = { sum: 0, n: 0, dur: 0, t: {} });
      var t = num(r.type) || 1, acc = num(r.accuracy);
      x.sum += acc; x.n++; x.dur += num(r.duration);
      var tt = x.t[t] || (x.t[t] = { sum: 0, n: 0 });
      tt.sum += acc; tt.n++;
    });
    return st;
  }
  function round1(v) { return Math.round(v * 10) / 10; }
  function statOf(st, sid, aid, types) {
    var x = st[sid + '|' + aid], avgs = {};
    types.forEach(function (t) { var tt = x && x.t[t]; avgs[t] = tt && tt.n ? round1(tt.sum / tt.n) : null; });
    return { avg: x && x.n ? round1(x.sum / x.n) : null, avgs: avgs, dur: x ? Math.round(x.dur) : 0, n: x ? x.n : 0 };
  }
  function fmtDur(sec) { sec = Math.round(num(sec)); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }

  handlers.t_assignmentResults = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a) throw err('課題が見つかりません。');
    var cl = splitClasses(a.classes);
    var types = aTypes(a), pl = passLine(a);
    var bests = {};
    types.forEach(function (t) {
      store.getBestsByAssignment(bestKey(a.id, t)).forEach(function (b) { (bests[b.sid] = bests[b.sid] || {})[t] = b; });
    });
    var aset = {}; aset[a.id] = true;
    var stats = recordStats(store, aset);
    var rows = store.getStudents().filter(function (s) {
      return !cl.length || cl.indexOf('全員') >= 0 || cl.indexOf(s.cls) >= 0 || bests[s.id];
    }).map(function (s) {
      var sx = statOf(stats, s.id, a.id, types);
      var bb = bests[s.id] || {}, b = bb[1], last = '', att = 0, per = {}, pp = {}, cleared = 0, total = 0, need = passNeed(a);
      types.forEach(function (t) {
        var x = bb[t];
        per[t] = x ? num(x.best) : null;
        pp[t] = passesOf(x, pl); total += pp[t];
        if (pp[t] >= need) cleared++;
        if (x) { att += num(x.attempts); if (str(x.last) > last) last = str(x.last); }
      });
      var achieved = isMaster(a) ? cleared === types.length : total >= need;
      return { id: s.id, cls: s.cls, no: s.no, name: str(s.name), bests: per, passes: pp, totalPasses: total,
        best: b ? num(b.best) : null, attempts: att, last: last, achieved: achieved,
        masterCleared: isMaster(a) && achieved, avgAll: sx.avg, avgs: sx.avgs, duration: sx.dur, durText: sx.n ? fmtDur(sx.dur) : '' };
    });
    return { assignment: { id: a.id, title: a.title, text: a.text, due: str(a.due), contest: bool(a.contest), classes: str(a.classes),
      types: types, mode: isMaster(a) ? 'master' : 'normal', pass: pl, passCount: passNeed(a), canEdit: canEditAssignment(me, a),
      start: str(a.start), scheduled: isScheduled(a) }, rows: rows };
  };

  handlers.t_studentDetail = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var s = store.getStudent(str(p.sid));
    if (!s) throw err('生徒が見つかりません。');
    var titles = {};
    store.getAssignments().forEach(function (a) { titles[a.id] = a.title; });
    var recs = store.getRecordsByStudent(s.id, 200).map(function (r) {
      return { time: r.time, kind: r.kind, title: r.aid ? (titles[r.aid] || '（削除された課題）') : (Sc.englishOnly(r.text).replace(/\n/g, ' ') || str(r.text)).slice(0, 40),
        accuracy: num(r.accuracy), correct: num(r.correct), total: num(r.total), transcript: str(r.transcript),
        flag: str(r.flag), audio: str(r.audio), reviewed: str(r.reviewed), rid: rid(r) };
    });
    var pub = studentPublic(s); pub.name = str(s.name); pub.av = avatarOf(achOf(s), 'teacher');
    return { student: pub, records: recs, rewards: rewardsPublic(achOf(s), s, jstDate(ctx.now()), store) };
  };

  handlers.t_export = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var cls = str(p.cls);
    var assignments = store.getAssignments().slice().sort(function (x, y) { return (x.created || '').localeCompare(y.created || ''); });
    var stats = recordStats(store, null);
    var header = ['クラス', '番号', '名前', '累計単語数', '級・段', '連続日数', '最終音読日'];
    assignments.forEach(function (a) {
      header.push(a.title + '（クリア回数）', a.title + '（全種類の平均%）');
      aTypes(a).forEach(function (t) { header.push(a.title + '・' + TYPE_NAME[t] + '（平均%）'); });
      header.push(a.title + '（音読時間 分:秒）', a.title + '（達成）');
    });
    var rows = [header];
    store.getStudents().filter(function (s) { return !cls || s.cls === cls; })
      .sort(function (x, y) { return x.cls.localeCompare(y.cls) || num(x.no) - num(y.no); })
      .forEach(function (s) {
        var row = [s.cls, num(s.no), str(s.name), num(s.totalWords), levelOf(num(s.totalWords)).name, num(s.streak), str(s.lastDate)];
        assignments.forEach(function (a) {
          var types = aTypes(a), pg = progress(store, s.id, a), sx = statOf(stats, s.id, a.id, types);
          row.push(pg.totalPasses, sx.avg === null ? '' : sx.avg);
          types.forEach(function (t) { row.push(sx.avgs[t] === null ? '' : sx.avgs[t]); });
          row.push(sx.n ? fmtDur(sx.dur) : '', pg.achieved ? '達成' : '');
        });
        rows.push(row);
      });
    return { rows: rows };
  };

  handlers.t_importStudents = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var rows = p.rows || [];
    var added = 0, updated = 0;
    rows.forEach(function (r) {
      var cls = str(r.cls), no = str(r.no);
      if (!cls || !no) return;
      var id = cls + '-' + no;
      var pass = str(r.pass) || String(1000 + Math.floor(Math.random() * 9000));
      if (store.getStudent(id)) { store.updateStudent(id, { name: str(r.name), pass: pass }); updated++; }
      else {
        store.addStudent({ id: id, cls: cls, no: no, name: str(r.name), pass: pass, nick: '', totalWords: 0,
          streak: 0, bestStreak: 0, lastDate: '', todayDate: '', todayWords: 0 });
        added++;
      }
    });
    return { added: added, updated: updated };
  };

  handlers.t_studentPasses = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    return { rows: store.getStudents().filter(function (s) { return canTeach(me, s.cls); }).map(function (s) { return { id: s.id, cls: s.cls, no: s.no, name: str(s.name), pass: str(s.pass) }; }) };
  };

  // ================= 先生スタンプ（作成・手動で押す） =================
  handlers.t_stamps = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    return { custom: customStamps(store).map(stampPublic), rules: STAMP_RULES, live: LIVE_STAMPS, animals: STAMP_ANIMALS,
      autoArt: autoStampArt(store), on: stampRulesOn(store), me: me.id, admin: me.admin };
  };
  handlers.t_saveStamp = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), it = p.stamp || {};
    var kind = it.kind === 'image' ? 'image' : 'art', text = str(it.text).slice(0, 14);
    if (kind === 'art' && !text) throw err('スタンプの言葉を入力してください。');
    var sp = STAMP_ANIMALS.indexOf(str(it.animal)) >= 0 ? str(it.animal) : 'cat';
    var po = STAMP_POSES.indexOf(str(it.pose)) >= 0 ? str(it.pose) : 'banzai', ex = STAMP_EXPRS.indexOf(str(it.expr)) >= 0 ? str(it.expr) : 'sparkle';
    var data = { kind: kind, text: text, animal: sp + ':' + po + ':' + ex,
      color: /^#[0-9a-fA-F]{6}$/.test(str(it.color)) ? str(it.color) : '', image: '' };
    if (kind === 'image') {
      var img = str(it.image);
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(img)) throw err('画像を選んでください。');
      if (img.length > MAX_STAMP_IMAGE) throw err('画像が大きすぎます。別の画像にしてください。');
      data.image = img;
    }
    if (it.id) {
      var cur = customStamps(store).filter(function (x) { return str(x.id) === str(it.id); })[0];
      if (!cur) throw err('スタンプが見つかりません。');
      if (!me.admin && str(cur.owner) !== me.id) throw err('ほかの先生が作ったスタンプは変更できません。');
      store.updateStamp(str(it.id), data);
      return { id: str(it.id) };
    }
    if (customStamps(store).length >= 100) throw err('スタンプは100個までです。使わないスタンプを削除してください。');
    data.id = 's' + ctx.now().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    data.owner = me.id; data.created = ctx.now().toISOString();
    store.addStamp(data);
    return { id: data.id };
  };
  handlers.t_deleteStamp = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), id = str(p.id);
    var cur = customStamps(store).filter(function (x) { return str(x.id) === id; })[0];
    if (!cur) throw err('スタンプが見つかりません。');
    if (!me.admin && str(cur.owner) !== me.id) throw err('ほかの先生が作ったスタンプは削除できません。');
    store.deleteStamp(id);
    var art = autoStampArt(store), ch = false;
    Object.keys(art).forEach(function (k) { if (art[k] === id) { delete art[k]; ch = true; } });
    if (ch) store.setSetting('自動スタンプの絵', JSON.stringify(art));
    return {};
  };
  handlers.t_giveStamp = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var def = findStampDef(store, p.stamp), entry = stampEntry(def);
    if (!entry) throw err('スタンプを選んでください。');
    var today = jstDate(ctx.now()), ups = [], seen = {};
    [].concat(p.sids || []).slice(0, 300).forEach(function (sid) {
      sid = str(sid); if (seen[sid]) return; seen[sid] = 1;
      var s = store.getStudent(sid);
      if (!s || !canTeach(me, s.cls)) return;
      s.ach = pushStamp(s, entry, 'manual', today, me.name);
      ups.push({ id: s.id, f: { ach: s.ach } });
    });
    if (!ups.length) throw err('スタンプを押す生徒を選んでください。');
    updateStudents(store, ups);
    return { count: ups.length };
  };

  // ================= ライブ =================
  function jsonObj(v) { try { var o = JSON.parse(str(v) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function liveClasses(store, l) {
    var cl = splitClasses(l.classes);
    if (cl.length) return cl;
    var a = store.getAssignment(str(l.aid));
    return a ? splitClasses(a.classes).filter(function (c) { return c !== '全員'; }) : [];
  }
  function liveOpen(l, now) { return str(l.status) === 'running' && (!str(l.ends) || now.toISOString() < str(l.ends)); }
  function liveRunning(store, s, now, aid) {
    if (!store.getLives) return null;
    var list = store.getLives().filter(function (l) {
      if (!liveOpen(l, now) || (aid && str(l.aid) !== aid)) return false;
      var cl = liveClasses(store, l);
      return !cl.length || cl.indexOf(s.cls) >= 0;
    });
    return list[0] || null;
  }
  function liveForStudent(store, s, now) {
    var l = liveRunning(store, s, now, '');
    return l ? { id: str(l.id), title: str(l.title), aid: str(l.aid), ends: str(l.ends) } : null;
  }
  // ポイントの高い順（同じなら先にそのポイントに達した人が上）
  function liveOrder(sc) {
    return Object.keys(sc).filter(function (k) { return num(sc[k].p) > 0; }).sort(function (x, y) {
      return num(sc[y].p) - num(sc[x].p) || (str(sc[x].t) < str(sc[y].t) ? -1 : str(sc[x].t) > str(sc[y].t) ? 1 : 0);
    });
  }
  // ライブのポイント：開催中は生徒ごとに別々に保存（同時に読んでも書きかえがぶつからない）、終わったらライブにまとめて保存
  function liveTargets(store, l) {
    var cl = liveClasses(store, l);
    return store.getStudents().filter(function (x) { return !cl.length || cl.indexOf(x.cls) >= 0; }).map(function (x) { return x.id; });
  }
  function liveScores(store, l) {
    if (str(l.status) === 'running' && store.getLiveScores) return store.getLiveScores(l, liveTargets(store, l));
    return jsonObj(l.scores);
  }
  function setLiveScore(store, l, sid, e, sc) {
    if (store.setLiveScore) store.setLiveScore(l, sid, e);
    else store.updateLive(str(l.id), { scores: JSON.stringify(sc) });
  }
  // ライブ中の音読かどうか（Apps Script では、これなら順番待ちなし・スプレッドシートを開かずに処理する）
  function isLiveSubmit(p, store, ctx) {
    if (!str(p.aid) || !store.getLives) return false;
    var now = ctx.now();
    if (!store.getLives().some(function (l) { return liveOpen(l, now) && str(l.aid) === str(p.aid); })) return false;
    var s = currentStudent(p, store, ctx), a = store.getAssignment(str(p.aid));
    return !!(a && assignmentVisibleTo(a, s) && liveRunning(store, s, now, a.id));
  }
  function liveRows(store, l) {
    var sc = liveScores(store, l);
    return liveOrder(sc).map(function (sid, i) {
      var s = store.getStudent(sid), e = sc[sid];
      return { rank: i + 1, sid: sid, name: s ? (str(s.nick) || s.cls + ' ' + s.no + '番') : sid, cls: s ? s.cls : '', av: s ? avatarOf(achOf(s), 'others') : null,
        points: num(e.p), count: num(e.c), best: Math.round(num(e.b) * 10) / 10 };
    });
  }
  function livePublic(store, l) {
    var a = store.getAssignment(str(l.aid));
    return { id: str(l.id), title: str(l.title), aid: str(l.aid), assignment: a ? a.title : '（削除された課題）', classes: liveClasses(store, l),
      status: str(l.status), created: str(l.created), started: str(l.started), ends: str(l.ends), ended: str(l.ended),
      minutes: num(l.minutes), owner: str(l.owner), awards: jsonObj(l.awards), results: str(l.results) ? JSON.parse(l.results) : null };
  }
  function liveVisible(me, store, l) {
    if (me.admin || str(l.owner) === me.id) return true;
    return liveClasses(store, l).some(function (c) { return me.classes.indexOf(c) >= 0; });
  }
  function getLiveFor(me, store, id) {
    var l = store.getLives().filter(function (x) { return str(x.id) === str(id); })[0];
    if (!l || !liveVisible(me, store, l)) throw err('ライブが見つかりません。');
    return l;
  }
  handlers.t_lives = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var list = store.getLives().filter(function (l) { return liveVisible(me, store, l); })
      .sort(function (x, y) { return str(y.created).localeCompare(str(x.created)); }).slice(0, 40)
      .map(function (l) { var o = livePublic(store, l); o.count = Object.keys(liveScores(store, l)).length; return o; });
    return { lives: list, custom: customStamps(store).map(stampPublic), live: LIVE_STAMPS };
  };
  handlers.t_createLive = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a) throw err('課題を選んでください。');
    var cl = splitClasses([].concat(p.classes || []).join(',')).filter(function (c) { return canTeach(me, c); });
    if (!cl.length && !me.admin) {
      cl = splitClasses(a.classes).filter(function (c) { return canTeach(me, c); });
      if (!cl.length) throw err('ライブを行うクラスを選んでください。');
    }
    var minutes = Math.max(0, Math.min(120, Math.round(num(p.minutes))));
    var aw = p.awards || {}, awards = {};
    ['top3', 'top10'].forEach(function (k) { if (str(aw[k]) && findStampDef(store, aw[k])) awards[k] = str(aw[k]); });
    var l = { id: 'L' + ctx.now().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36), title: str(p.title).slice(0, 60) || a.title,
      aid: a.id, classes: cl.join(','), status: 'ready', created: ctx.now().toISOString(), started: '', ends: '', ended: '',
      minutes: minutes, owner: me.id, scores: '{}', results: '', awards: JSON.stringify(awards) };
    store.addLive(l);
    return { id: l.id };
  };
  handlers.t_startLive = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), l = getLiveFor(me, store, p.id);
    if (str(l.status) !== 'ready') throw err('このライブは、すでに始まっているか終わっています。');
    var now = ctx.now(), mins = num(l.minutes);
    store.updateLive(str(l.id), { status: 'running', started: now.toISOString(), ends: mins ? new Date(now.getTime() + mins * 60000).toISOString() : '', scores: '{}' });
    return { board: liveBoard(store, getLiveFor(me, store, p.id), now) };
  };
  function liveBoard(store, l, now) {
    var rows = liveRows(store, l), pub = livePublic(store, l);
    return { live: pub, rows: rows.slice(0, 60), total: rows.length, now: now.toISOString(),
      stampImgs: stampImgs(store, (pub.results || []).map(function (x) { return x.stamp; })) };
  }
  handlers.t_liveBoard = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    return liveBoard(store, getLiveFor(me, store, p.id), ctx.now());
  };
  handlers.t_endLive = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), l = getLiveFor(me, store, p.id), now = ctx.now();
    if (str(l.status) === 'ended') return { board: liveBoard(store, l, now) };
    var finalScores = liveScores(store, l), rows = liveRows(store, l), aw = jsonObj(l.awards), today = jstDate(now), ups = [];
    rows.slice(0, 10).forEach(function (row) {
      var key = row.rank <= 3 ? (aw.top3 || 'l:rank' + row.rank) : (aw.top10 || 'l:top10');
      var entry = stampEntry(findStampDef(store, key)) || stampEntry(LIVE_STAMPS[row.rank <= 3 ? 'rank' + row.rank : 'top10']);
      var s = store.getStudent(row.sid); if (!s) return;
      s.ach = pushStamp(s, entry, 'live', today, str(l.title));
      var ach2 = achOf(s);
      liveItems(row.rank).forEach(function (id) { if (ach2.own.indexOf(id) < 0) ach2.own.push(id); });
      s.ach = JSON.stringify(ach2);
      ups.push({ id: s.id, f: { ach: s.ach } });
      row.stamp = entry;
    });
    updateStudents(store, ups);
    var results = rows.slice(0, 10).map(function (x) { return { rank: x.rank, name: x.name, cls: x.cls, points: x.points, count: x.count, best: x.best, stamp: x.stamp, av: x.av }; });
    store.updateLive(str(l.id), { status: 'ended', ended: now.toISOString(), results: JSON.stringify(results), scores: JSON.stringify(finalScores) });
    return { board: liveBoard(store, getLiveFor(me, store, p.id), now), awarded: ups.length };
  };
  handlers.t_deleteLive = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx), l = getLiveFor(me, store, p.id);
    if (!me.admin && str(l.owner) !== me.id) throw err('ほかの先生のライブは削除できません。');
    store.deleteLive(str(l.id));
    return {};
  };

  handlers.t_saveSettings = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var st = p.settings || {};
    if ('allowNick' in st) store.setSetting('ニックネームを使う', st.allowNick ? 'TRUE' : 'FALSE');
    if ('showRanking' in st) store.setSetting('ランキングを表示', st.showRanking ? 'TRUE' : 'FALSE');
    if ('appTitle' in st) store.setSetting('アプリ名', str(st.appTitle).slice(0, 30));
    if ('phraseCheck' in st) store.setSetting('合言葉チェック', st.phraseCheck ? 'TRUE' : 'FALSE');
    if ('saveAudio' in st) store.setSetting('音声を保存', st.saveAudio ? 'TRUE' : 'FALSE');
    if ('autoStamps' in st) {
      var ids = [].concat(st.autoStamps || []).filter(function (x) { return STAMP_RULES.some(function (r) { return r.id === x; }); });
      store.setSetting('自動スタンプ', ids.length ? ids.join(',') : 'なし');
    }
    if ('autoArt' in st) {
      var art = {}, have = {};
      customStamps(store).forEach(function (x) { have[str(x.id)] = 1; });
      Object.keys(st.autoArt || {}).forEach(function (k) {
        var v = str(st.autoArt[k]);
        if (v && have[v] && STAMP_RULES.some(function (r) { return r.id === k; })) art[k] = v;
      });
      store.setSetting('自動スタンプの絵', JSON.stringify(art));
    }
    return {};
  };

  // ---- 自分のパスワード変更 ----
  handlers.t_changePassword = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var t = store.getTeacher(me.id);
    if (!passMatches(t, str(p.oldPass))) throw err('今のパスワードがちがいます。');
    if (str(p.newPass).length < 6) throw err('新しいパスワードは6文字以上にしてください。');
    store.updateTeacher(me.id, { pass: hashPass(me.id, str(p.newPass)) });
    return {};
  };

  // ---- 管理者：先生のアカウント ----
  handlers.t_teachers = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    return { teachers: store.getTeachers().map(teacherPublic), classes: classList(store).map(function (c) { return c.name; }) };
  };
  handlers.t_saveTeacher = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var t = p.teacher || {};
    var id = str(t.id).toLowerCase();
    if (!/^[a-z0-9._-]{3,20}$/.test(id)) throw err('ログインIDは、半角英数字（3〜20文字）にしてください。');
    var name = str(t.name).slice(0, 30);
    if (!name) throw err('名前を入力してください。');
    var data = { name: name, role: t.role === 'admin' ? 'admin' : 'teacher', classes: splitClasses(t.classes).join(','),
      active: t.active !== false };
    var ex = store.getTeacher(id);
    if (t.isNew) {
      if (ex) throw err('そのログインIDはすでに使われています。');
      var pw = randomPass();
      data.id = id; data.pass = hashPass(id, pw); data.created = ctx.now().toISOString();
      store.addTeacher(data);
      return { id: id, password: pw };
    }
    if (!ex) throw err('先生が見つかりません。');
    // 管理者が1人もいなくならないようにする
    var admins = store.getTeachers().filter(function (x) { var tp = teacherPublic(x); return tp.admin && tp.active && x.id !== id; });
    if ((data.role !== 'admin' || !data.active) && teacherPublic(ex).admin && !admins.length) throw err('管理者が1人もいなくなるため、変更できません。');
    store.updateTeacher(id, data);
    return { id: id };
  };
  handlers.t_resetTeacherPass = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var id = str(p.id).toLowerCase();
    if (!store.getTeacher(id)) throw err('先生が見つかりません。');
    var pw = randomPass();
    store.updateTeacher(id, { pass: hashPass(id, pw) });
    return { id: id, password: pw };
  };
  handlers.t_deleteTeacher = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var id = str(p.id).toLowerCase();
    if (id === me.id) throw err('自分のアカウントは削除できません。');
    var ex = store.getTeacher(id);
    if (!ex) throw err('先生が見つかりません。');
    store.deleteTeacher(id);
    return {};
  };

  // ---- 管理者：クラスと人数 ----
  handlers.t_classes = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var teachers = store.getTeachers().map(teacherPublic);
    return { classes: classList(store).map(function (c) {
      c.teachers = teachers.filter(function (t) { return t.active && t.classes.indexOf(c.name) >= 0; }).map(function (t) { return t.name; });
      return c;
    }), admin: me.admin };
  };
  // 人数を設定：増やすと生徒（番号・パスコード）を自動で追加、減らすと番号の大きい生徒を削除（confirm が必要）
  handlers.t_saveClass = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var name = str(p.name).replace(/\s/g, '').slice(0, 12);
    if (!name || /[,、]/.test(name)) throw err('クラス名を正しく入力してください（例：1A、1-1）。');
    var count = Math.round(num(p.count));
    if (count < 0 || count > 60) throw err('人数は0〜60人にしてください。');
    var students = store.getStudents().filter(function (s) { return s.cls === name; });
    var removing = students.filter(function (s) { return num(s.no) > count; });
    if (removing.length && !p.confirm) {
      return { needConfirm: true, removing: removing.map(function (s) { return s.cls + ' ' + s.no + '番 ' + str(s.name); }) };
    }
    removing.forEach(function (s) { store.deleteStudent(s.id); });
    var added = 0;
    for (var i = 1; i <= count; i++) {
      var sid = name + '-' + i;
      if (!store.getStudent(sid)) {
        store.addStudent({ id: sid, cls: name, no: String(i), name: '', pass: String(1000 + Math.floor(Math.random() * 9000)), nick: '',
          totalWords: 0, streak: 0, bestStreak: 0, lastDate: '', todayDate: '', todayWords: 0 });
        added++;
      }
    }
    store.setClass(name, count);
    return { added: added, removed: removing.length };
  };
  handlers.t_deleteClass = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    adminOnly(me);
    var name = str(p.name);
    var students = store.getStudents().filter(function (s) { return s.cls === name; });
    if (students.length && !p.confirm) return { needConfirm: true, removing: students.map(function (s) { return s.cls + ' ' + s.no + '番 ' + str(s.name); }) };
    students.forEach(function (s) { store.deleteStudent(s.id); });
    store.deleteClass(name);
    store.getTeachers().forEach(function (t) {
      var cl = splitClasses(t.classes);
      if (cl.indexOf(name) >= 0) store.updateTeacher(t.id, { classes: cl.filter(function (c) { return c !== name; }).join(',') });
    });
    return { removed: students.length };
  };
  // ---- 英文の自動和訳（Apps Script の翻訳機能を使う） ----
  handlers.t_translate = function (p, store, ctx) {
    currentTeacher(p, store, ctx);
    if (!ctx.translate) return { unsupported: true };
    var list = [].concat(p.sentences || []).slice(0, 80).map(function (x) { return str(x).slice(0, 1000); });
    return { ja: list.map(function (x) { return x ? ctx.translate(x) : ''; }) };
  };

  handlers.t_me = function (p, store, ctx) {
    return { me: currentTeacher(p, store, ctx) };
  };

  // ---- 不正の疑い（要確認）----
  var FLAG_DAYS = 90;
  function rid(r) { return str(r.time) + '|' + str(r.sid); }
  function openFlags(store, today) {
    var n = 0;
    store.getFlaggedRecords(addDays(today, -FLAG_DAYS)).forEach(function (r) { if (!str(r.reviewed)) n++; });
    return n;
  }
  handlers.t_flagCount = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    return { count: openFlags(store, jstDate(ctx.now())) + pendingPics(store, me).length };
  };
  handlers.t_flags = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var today = jstDate(ctx.now());
    var byId = {}, titles = {};
    store.getStudents().forEach(function (s) { byId[s.id] = s; });
    store.getAssignments().forEach(function (a) { titles[a.id] = a.title; });
    var list = store.getFlaggedRecords(addDays(today, -FLAG_DAYS))
      .filter(function (r) { return p.all || !str(r.reviewed); })
      .slice(0, 200)
      .map(function (r) {
        var s = byId[r.sid] || { cls: '', no: '', name: '' };
        return { rid: rid(r), time: r.time, sid: r.sid, cls: s.cls, no: s.no, name: str(s.name), kind: r.kind,
          title: r.aid ? (titles[r.aid] || '（削除された課題）') : (Sc.englishOnly(r.text).replace(/\n/g, ' ') || str(r.text)).slice(0, 60),
          flag: str(r.flag), reviewed: str(r.reviewed), audio: str(r.audio), transcript: str(r.transcript),
          accuracy: num(r.accuracy), total: num(r.total), canReview: canTeach(me, s.cls) };
      });
    return { list: list, open: openFlags(store, today) };
  };
  // 先生が確認：ok＝問題なし（記録を認めて単語数を加える）／ng＝不正あり
  handlers.t_reviewFlag = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var r = store.findRecord(str(p.rid));
    if (!r || !str(r.flag)) throw err('記録が見つかりません。');
    var rs = store.getStudent(r.sid);
    if (rs && !canTeach(me, rs.cls)) throw err('担当していないクラスの生徒は確認できません。');
    if (str(r.reviewed)) return { reviewed: r.reviewed };  // 自動で無効になったもの・確認済みのものは変更しない
    var day = jstDate(ctx.now());
    var ok = p.verdict === 'ok';
    var label = (ok ? '問題なし' : '不正あり') + '（' + day + '）';
    var upd = { reviewed: label };
    if (ok) {
      var credit = Math.round(num(r.accuracy) * num(r.total) / 100);
      upd.correct = credit;
      var s = store.getStudent(r.sid);
      if (s && credit) store.updateStudent(s.id, { totalWords: num(s.totalWords) + credit });
      if (r.aid) {
        var rk = bestKey(r.aid, num(r.type) || 1);
        var b = store.getBest(r.sid, rk);
        var better = !b || num(r.accuracy) > num(b.best);
        var ra = store.getAssignment(r.aid), rpl = ra ? passLine(ra) : 80;
        store.setBest(r.sid, rk, {
          best: b ? Math.max(num(b.best), num(r.accuracy)) : num(r.accuracy),
          attempts: (b ? num(b.attempts) : 0) + 1, last: r.time,
          passes: passesOf(b, rpl) + (num(r.accuracy) >= rpl ? 1 : 0),
          bestAt: better ? r.time : (b ? b.bestAt : r.time)
        });
      }
    }
    store.updateRecord(str(p.rid), upd);
    return { reviewed: label };
  };

  handlers.t_audio = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    if (!store.getAudio) throw err('音声を読み込めません。');
    var a = store.getAudio(str(p.id));
    if (!a) throw err('音声が見つかりません（削除されたか、デモモードで前回のページ表示より前の録音です）。');
    return { mime: a.mime, b64: a.b64 };
  };

  var WRITE_ACTIONS = { submit: 1, setNick: 1, setLook: 1, seenStamps: 1, setAvatar: 1, buyItem: 1, seenItems: 1, uploadAvatarPic: 1, t_reviewPic: 1, t_saveLibrary: 1, t_deleteLibrary: 1, t_hideLibrary: 1, t_saveAssignment: 1, t_deleteAssignment: 1, t_saveFolder: 1, t_deleteFolder: 1, t_moveToFolder: 1,
    t_importStudents: 1, t_saveSettings: 1, t_reviewFlag: 1, t_changePassword: 1, t_saveTeacher: 1,
    t_resetTeacherPass: 1, t_deleteTeacher: 1, t_saveClass: 1, t_deleteClass: 1, teacherLogin: 1,
    t_saveStamp: 1, t_deleteStamp: 1, t_giveStamp: 1, t_createLive: 1, t_startLive: 1, t_endLive: 1, t_deleteLive: 1 };

  function handle(action, payload, store, ctx) {
    var fn = handlers[action];
    if (!fn) return { ok: false, error: '不明な操作です：' + action };
    NOW_STR = new Date(ctx.now().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
    try {
      var res = fn(payload || {}, store, ctx);
      res.ok = true;
      return res;
    } catch (e) {
      return { ok: false, error: e.userMessage || ('エラーが発生しました：' + (e && e.message)) };
    }
  }

  var api = { handle: handle, sha256: sha256, hashPass: hashPass, levelOf: levelOf, LEVELS: LEVELS, jstDate: jstDate, addDays: addDays,
    weekStart: weekStart, WRITE_ACTIONS: WRITE_ACTIONS, preSubmit: preSubmit, isLiveSubmit: isLiveSubmit, FORTUNE_ODDS: FORTUNE_ODDS,
    FOLDER_DEPTH: FOLDER_DEPTH, BADGES: BADGES, STAMP_RULES: STAMP_RULES, THEMES: THEMES, LIVE_STAMPS: LIVE_STAMPS, STAMP_ANIMALS: STAMP_ANIMALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

/* =====================================================================
 *  Google Apps Script 用：スプレッドシートを保存先にする部分
 * ===================================================================== */

var SHEETS = {
  students: { name: '生徒', cols: [
    ['cls', 'クラス', '@'], ['no', '番号', '0'], ['name', '名前', '@'], ['pass', 'パスコード', '@'],
    ['nick', 'ニックネーム', '@'], ['totalWords', '累計単語数', '0'], ['streak', '連続日数', '0'],
    ['bestStreak', '最長連続日数', '0'], ['lastDate', '最終音読日', '@'], ['todayDate', '今日の日付', '@'],
    ['todayWords', '今日の単語数', '0'], ['ach', '実績データ（自動）', '@']] },
  assignments: { name: '課題', cols: [
    ['id', '課題ID', '@'], ['title', 'タイトル', '@'], ['text', '英文', '@'], ['ja', '和訳', '@'],
    ['classes', '対象クラス', '@'], ['due', '締切', '@'], ['contest', '音読大会', 'check'],
    ['published', '公開', 'check'], ['created', '作成日時', '@'], ['words', '単語数', '0'],
    ['types', '音読の種類', '@'], ['mode', 'モード', '@'], ['blanks', '穴あき位置', '@'], ['pass', '合格ライン', '0'], ['owner', '作成した先生', '@'], ['start', '開始日時', '@'], ['passCount', '合格回数', '0'], ['folder', 'フォルダID', '@']] },
  folders: { name: '課題フォルダ', cols: [['id', 'ID', '@'], ['name', 'フォルダ名', '@'], ['parent', '親フォルダID（空欄＝いちばん上）', '@'],
    ['owner', '作成した先生', '@'], ['created', '作成日時', '@']] },
  records: { name: '記録', cols: [
    ['time', '日時', '@'], ['date', '日付', '@'], ['sid', '生徒ID', '@'], ['aid', '課題ID', '@'],
    ['kind', '種別', '@'], ['accuracy', '正確さ(%)', '0.0'], ['correct', '読めた単語数', '0'],
    ['total', '全単語数', '0'], ['duration', '秒数', '0'], ['transcript', '聞き取り結果', '@'], ['text', '自主練の英文', '@'],
    ['flag', '注意', '@'], ['audio', '音声ファイルID', '@'], ['reviewed', '先生の確認', '@'], ['type', '音読の種類', '0']] },
  bests: { name: '課題別ベスト', cols: [
    ['sid', '生徒ID', '@'], ['aid', '課題ID', '@'], ['best', '最高正確さ(%)', '0.0'], ['attempts', '回数', '0'],
    ['last', '最終日時', '@'], ['bestAt', 'ベスト達成日時', '@'], ['passes', '合格回数', '0']] },
  settings: { name: '設定', cols: [['key', '項目', '@'], ['value', '値', '@'], ['note', '説明', '@']] },
  teachers: { name: '先生', cols: [
    ['id', 'ログインID', '@'], ['name', '名前', '@'], ['pass', 'パスワード（暗号化）', '@'], ['role', '役割（admin＝管理者）', '@'],
    ['classes', '担当クラス', '@'], ['active', '有効', 'check'], ['created', '作成日時', '@']] },
  classes: { name: 'クラス', cols: [['name', 'クラス', '@'], ['count', '人数', '0']] },
  library: { name: 'ライブラリ', cols: [['id', 'ID', '@'], ['level', 'レベル（1中1・2中2・3中3・4高校）', '0'], ['title', 'タイトル', '@'],
    ['text', '英文', '@'], ['ja', '和訳', '@'], ['owner', '作成した先生', '@'], ['created', '作成日時', '@']] },
  stamps: { name: '先生スタンプ', cols: [['id', 'ID', '@'], ['kind', '種類（art：絵／image：画像）', '@'], ['animal', '絵', '@'], ['text', '言葉', '@'],
    ['color', '色', '@'], ['image', '画像データ（自動）', '@'], ['owner', '作成した先生', '@'], ['created', '作成日時', '@']] },
  pics: { name: 'アバター画像', cols: [['id', 'ID', '@'], ['sid', '生徒ID', '@'], ['image', '画像データ（自動）', '@'], ['kind', '種類（draw：絵／photo：画像）', '@'],
    ['status', '状態（p：確認待ち／ok：OK／x：使えない）', '@'], ['created', '作成日時', '@'], ['reviewed', '確認した日時・先生', '@']] }
};

var DEFAULT_SETTINGS = [
  ['アプリ名', '', '画面上部に表示する名前（空欄なら既定の名前）'],
  ['ランキングを表示', 'TRUE', 'TRUE：生徒にランキングを表示 / FALSE：表示しない'],
  ['ニックネームを使う', 'TRUE', 'TRUE：ランキングでニックネームを使える / FALSE：クラスと番号で表示'],
  ['ログイン有効日数', '30', '生徒が再ログインせずに使える日数'],
  ['合言葉チェック', 'TRUE', 'TRUE：音読の途中に毎回変わる合言葉を読ませ、確認できない場合は記録しない'],
  ['音声を保存', 'TRUE', 'TRUE：音読の音声をGoogleドライブに保存し、先生画面で再生できる'],
  ['音声の保存日数', '60', 'メニュー「古い音声を削除」で、この日数より古い音声をゴミ箱へ移す'],
  ['自動スタンプ', '', '条件を満たした生徒に自動で押す先生スタンプ（空欄：すべて / なし：押さない）'],
  ['ライブラリ非表示', '', '生徒に表示しない、最初から入っているライブラリ英文のID'],
  ['自動スタンプの絵', '', '自動スタンプで押す、先生が作ったスタンプ（アプリの「スタンプ」画面で設定）']
];

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function fmtCell_(v, key) {
  if (v instanceof Date) {
    if (key === 'time' || key === 'created' || key === 'last' || key === 'bestAt') return v.toISOString();
    if (key === 'start') return Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm");
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return v;
}

/* ---------- 読み込みの高速化（スクリプトキャッシュ） ----------
 * 名簿・課題・設定などを Apps Script のキャッシュに置き、読むだけの処理ではスプレッドシートを開かずに済ませます。
 * ・書き込む処理（ロック中）は必ずシートから読み、書いたあとの最新データをキャッシュに入れ直します。
 * ・キャッシュは「世代番号」つきで保存し、書き込みのたびに世代を新しくします（古いデータは使われません）。
 * ・スプレッドシートを手で編集したときは onEdit で世代を新しくします。行の削除などは最長10分で反映されます。 */
var CACHED_SHEETS_ = ['students', 'settings', 'assignments', 'classes', 'teachers', 'library', 'bests', 'stamps', 'folders'];
var CACHE_TTL_ = 600, CACHE_CHUNK_ = 30000;
function sc_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
function newGen_() { return Date.now().toString(36) + Math.floor(Math.random() * 1e8).toString(36); }
function cacheGens_() {
  var c = sc_(); if (!c) return {};
  try { return c.getAll(CACHED_SHEETS_.map(function (k) { return 'g:' + k; })) || {}; } catch (e) { return {}; }
}
function cacheRead_(k, gen) {
  var c = sc_(); if (!c || !gen) return null;
  try {
    var base = 'd:' + k + ':' + gen + ':', first = c.get(base + 0);
    if (!first) return null;
    var bar = first.indexOf('|'), cnt = +first.slice(0, bar), parts = [first.slice(bar + 1)];
    if (cnt > 1) {
      var keys = []; for (var i = 1; i < cnt; i++) keys.push(base + i);
      var m = c.getAll(keys);
      for (var j = 0; j < keys.length; j++) { if (!m[keys[j]]) return null; parts.push(m[keys[j]]); }
    }
    var d = JSON.parse(parts.join('')), cols = SHEETS[k].cols, rows = [];
    for (var r = 0; r < d.length; r++) {
      var o = { _row: d[r][0] };
      for (var x = 0; x < cols.length; x++) o[cols[x][0]] = d[r][x + 1];
      rows.push(o);
    }
    return rows;
  } catch (e) { return null; }
}
function cacheWrite_(k, gen, rows) {
  var c = sc_(); if (!c) return false;
  try {
    var cols = SHEETS[k].cols;
    var s = JSON.stringify(rows.map(function (o) {
      var a = [o._row]; for (var x = 0; x < cols.length; x++) { var v = o[cols[x][0]]; a.push(v === undefined ? '' : v); } return a;
    }));
    var cnt = Math.max(1, Math.ceil(s.length / CACHE_CHUNK_));
    if (cnt > 80) return false; // 大きすぎるときはキャッシュしない
    var o = {};
    for (var i = 0; i < cnt; i++) o['d:' + k + ':' + gen + ':' + i] = (i === 0 ? cnt + '|' : '') + s.substr(i * CACHE_CHUNK_, CACHE_CHUNK_);
    c.putAll(o, CACHE_TTL_);
    return true;
  } catch (e) { return false; }
}
// 世代を新しくする（rows があれば、その内容を新しい世代として保存）
function cacheBump_(k, rows) {
  var c = sc_(); if (!c) return;
  var g = newGen_();
  if (rows && !cacheWrite_(k, g, rows)) g = newGen_();
  try { c.put('g:' + k, g, 21600); } catch (e) { /* noop */ }
}
function cacheClearAll_() { CACHED_SHEETS_.forEach(function (k) { cacheBump_(k); }); }

/* ---------- 保存先（store） ----------
 * opt.fresh: true（すべてのシートをシートから読む）／{ students: 1, ... }（指定したシートだけ）／なし（キャッシュを使う） */
function SheetStore(opt) {
  opt = opt || {};
  this.cache = {}; this._book = null; this.fresh = opt.fresh || null; this.request = !!opt.request;
  this.dirty = {}; this.fromSheet = {}; this.gens = null;
}
SheetStore.prototype.book_ = function () { return this._book || (this._book = ss_()); };
SheetStore.prototype.isFresh_ = function (k) { return this.fresh === true || !!(this.fresh && this.fresh[k]); };
SheetStore.prototype.touch_ = function (k) {
  this.dirty[k] = true;
  if (this.gens) delete this.gens['g:' + k]; // この処理の中では、もうキャッシュを使わない
  if (!this.request && CACHED_SHEETS_.indexOf(k) >= 0) cacheBump_(k); // メニューなど、ウェブアプリ以外からの書き込み
};
SheetStore.prototype.delRow_ = function (k, row) { this.sheet(k).deleteRow(row); this.cache[k] = null; this.touch_(k); };
// 書き込む処理のあと：最新のデータをキャッシュへ
SheetStore.prototype.publishCache_ = function () {
  var self = this, gens = null;
  CACHED_SHEETS_.forEach(function (k) {
    var rows = self.cache[k] && self.fromSheet[k] ? self.cache[k] : null;
    if (self.dirty[k]) { cacheBump_(k, rows); return; }
    if (!rows) return;
    if (!gens) gens = cacheGens_();
    if (!gens['g:' + k]) cacheBump_(k, rows); // キャッシュが空なら、ついでに入れておく
  });
};

SheetStore.prototype.sheet = function (k) {
  var sh = this.book_().getSheetByName(SHEETS[k].name);
  if (!sh && (k === 'library' || k === 'stamps' || k === 'pics' || k === 'folders')) {
    // あとから追加したシートは、なければ自動で作る
    try { sh = this.book_().insertSheet(SHEETS[k].name); }
    catch (e) { sh = this.book_().getSheetByName(SHEETS[k].name); if (!sh) throw e; return sh; } // 同時に作られたとき
    sh.getRange(1, 1, 1, SHEETS[k].cols.length).setValues([SHEETS[k].cols.map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e3f1f6');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('「' + SHEETS[k].name + '」シートがありません。メニューの「音読アプリ」→「初期設定」を実行してください。');
  return sh;
};
// シート全体を読み込み（小さいシート用）
SheetStore.prototype.load = function (k) {
  if (this.cache[k]) return this.cache[k];
  var cacheable = CACHED_SHEETS_.indexOf(k) >= 0, gen = null;
  if (cacheable) {
    if (!this.gens) this.gens = cacheGens_();
    gen = this.gens['g:' + k] || null; // 世代はシートを読む「前」に確認する
    if (gen && !this.isFresh_(k)) {
      var hit = cacheRead_(k, gen);
      if (hit) { this.cache[k] = hit; return hit; }
    }
    // まだ世代がないときは、シートを読む「前」に世代を作っておく（このあと書き込みがあれば、そちらの世代が優先される）
    if (!gen && !this.isFresh_(k) && !this.dirty[k]) {
      var c = sc_();
      if (c) { gen = newGen_(); try { c.put('g:' + k, gen, 21600); this.gens['g:' + k] = gen; } catch (e) { gen = null; } }
    }
  }
  var sh = this.sheet(k), cols = SHEETS[k].cols, last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = { _row: i + 2 };
      var empty = true;
      for (var j = 0; j < cols.length; j++) {
        o[cols[j][0]] = fmtCell_(vals[i][j], cols[j][0]);
        if (vals[i][j] !== '' && vals[i][j] !== null) empty = false;
      }
      if (!empty) rows.push(o);
    }
  }
  this.cache[k] = rows; this.fromSheet[k] = true;
  if (cacheable && gen && !this.isFresh_(k) && !this.dirty[k]) cacheWrite_(k, gen, rows);
  return rows;
};
SheetStore.prototype.writeRow = function (k, obj) {
  var cols = SHEETS[k].cols, sh = this.sheet(k);
  // あとから増えた列（課題の「フォルダID」など）は、見出しがなければ書き足す
  this.headOk_ = this.headOk_ || {};
  if (!this.headOk_[k]) {
    this.headOk_[k] = true;
    var lc = sh.getLastColumn();
    if (lc < cols.length) sh.getRange(1, lc + 1, 1, cols.length - lc).setValues([cols.slice(lc).map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e3f1f6');
  }
  // 文字の列（クラス名など）は、スプレッドシートが日付や数値に自動変換しないよう「書式なしテキスト」にしてから書く
  var row = cols.map(function (c) { var v = obj[c[0]]; v = v === undefined || v === null ? '' : v; return c[2] === '@' && v !== '' ? String(v) : v; });
  var fmts = cols.map(function (c) { return c[2] === 'check' ? 'General' : c[2]; });
  if (!obj._row) obj._row = Math.max(sh.getLastRow(), 1) + 1;
  var rng = sh.getRange(obj._row, 1, 1, cols.length);
  rng.setNumberFormats([fmts]);
  rng.setValues([row]);  this.touch_(k);
};

// 生徒
SheetStore.prototype.getStudents = function () {
  return this.load('students').filter(function (s) { return String(s.cls).trim() && String(s.no).trim(); })
    .map(function (s) {
      s.cls = String(s.cls).trim(); s.no = String(s.no).trim().replace(/\.0+$/, '');
      s.id = s.cls + '-' + s.no; return s;
    });
};
SheetStore.prototype.getStudent = function (id) {
  var list = this.getStudents();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};
SheetStore.prototype.updateStudent = function (id, f) {
  var s = this.getStudent(id); if (!s) return;
  for (var k in f) s[k] = f[k];
  this.writeRow('students', s);
};
SheetStore.prototype.addStudent = function (s) {
  this.writeRow('students', s);
  this.load('students').push(s);
};

// 英文ライブラリ（先生が追加したもの）
SheetStore.prototype.getLibrary = function () { return this.load('library').filter(function (x) { return x.id; }); };
SheetStore.prototype.addLibrary = function (x) { this.writeRow('library', x); this.load('library').push(x); };
SheetStore.prototype.updateLibrary = function (id, f) {
  var l = this.getLibrary();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { for (var k in f) l[i][k] = f[k]; this.writeRow('library', l[i]); }
};
SheetStore.prototype.deleteLibrary = function (id) {
  var l = this.getLibrary();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { this.delRow_('library', l[i]._row); return; }
};

// 何行かまとめて書き込む（つながっている行は1回で書く）
SheetStore.prototype.writeRows_ = function (k, objs) {
  var cols = SHEETS[k].cols, sh = this.sheet(k), self = this;
  var list = objs.filter(function (o) { return o._row; }).sort(function (x, y) { return x._row - y._row; });
  objs.filter(function (o) { return !o._row; }).forEach(function (o) { self.writeRow(k, o); });
  var fmts = cols.map(function (c) { return c[2] === 'check' ? 'General' : c[2]; });
  function rowOf(obj) { return cols.map(function (c) { var v = obj[c[0]]; v = v === undefined || v === null ? '' : v; return c[2] === '@' && v !== '' ? String(v) : v; }); }
  var i = 0;
  while (i < list.length) {
    var j = i; while (j + 1 < list.length && list[j + 1]._row === list[j]._row + 1) j++;
    var group = list.slice(i, j + 1), rng = sh.getRange(group[0]._row, 1, group.length, cols.length);
    rng.setNumberFormats(group.map(function () { return fmts; }));
    rng.setValues(group.map(rowOf));
    i = j + 1;
  }
  this.touch_(k);
};
SheetStore.prototype.updateStudents = function (ups) {
  var self = this, objs = [];
  ups.forEach(function (u) { var s = self.getStudent(u.id); if (!s) return; for (var k in u.f) s[k] = u.f[k]; objs.push(s); });
  if (objs.length) this.writeRows_('students', objs);
};

// 先生が作ったスタンプ
SheetStore.prototype.getStamps = function () { return this.load('stamps').filter(function (x) { return x.id; }); };
SheetStore.prototype.addStamp = function (x) { this.writeRow('stamps', x); this.load('stamps').push(x); };
SheetStore.prototype.updateStamp = function (id, f) {
  var l = this.getStamps();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { for (var k in f) l[i][k] = f[k]; this.writeRow('stamps', l[i]); }
};
SheetStore.prototype.deleteStamp = function (id) {
  var l = this.getStamps();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { this.delRow_('stamps', l[i]._row); return; }
};
// アバターの絵・画像（大きいのでキャッシュしない）
SheetStore.prototype.getPics = function () { return this.load('pics').filter(function (x) { return x.id; }); };
SheetStore.prototype.addPic = function (x) { this.writeRow('pics', x); this.load('pics').push(x); };
SheetStore.prototype.updatePic = function (id, f) {
  var l = this.getPics();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { for (var k in f) l[i][k] = f[k]; this.writeRow('pics', l[i]); }
};
SheetStore.prototype.deletePic = function (id) {
  var l = this.getPics();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { this.delRow_('pics', l[i]._row); return; }
};
// ライブ
/* ---------- ライブ ----------
 * ライブの記録（開催の一覧・ポイント・結果）はスプレッドシートに保存しません。
 * Apps Script のキャッシュに一時的に置き、終わってから6時間（未開始のものは作ってから6時間）で消えます。 */
var LIVE_KEY_ = 'live:v1', LIVE_TTL_ = 21600;
SheetStore.prototype.liveList_ = function () {
  if (this.livesMem_) return this.livesMem_;
  var c = sc_(), v = null, l = [];
  try { v = c ? c.get(LIVE_KEY_) : null; } catch (e) { v = null; }
  try { l = v ? JSON.parse(v) : []; } catch (e) { l = []; }
  if (!(l instanceof Array)) l = [];
  this.livesMem_ = l;
  return l;
};
SheetStore.prototype.liveSave_ = function () {
  var now = Date.now(), l = (this.livesMem_ || []).filter(function (x) {
    var t = Date.parse(x.ended || x.ends || x.started || x.created || '') || now;
    return x.id && now - t < LIVE_TTL_ * 1000;
  });
  var txt = JSON.stringify(l);
  while (txt.length > 95000 && l.length > 1) { l.shift(); txt = JSON.stringify(l); }   // キャッシュに置ける大きさ（約100KB）まで、古いものから消す
  this.livesMem_ = l;
  var c = sc_();
  if (!c) throw new Error('ライブの一時保存ができませんでした。もう一度ためしてください。');
  c.put(LIVE_KEY_, txt, LIVE_TTL_);
  this.dropLiveSheet_();
};
// 以前の版で作った「ライブ」シートは、最初に一度だけ削除する
SheetStore.prototype.dropLiveSheet_ = function () {
  if (this.liveDropChecked_) return; this.liveDropChecked_ = true;
  var pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('LIVE_SHEET_DROPPED')) return;
  try { var sh = this.book_().getSheetByName('ライブ'); if (sh) this.book_().deleteSheet(sh); pr.setProperty('LIVE_SHEET_DROPPED', '1'); } catch (e) { /* 次回もう一度 */ }
};
// 開催中のライブのポイント（生徒ごとに別のキャッシュに置くので、同時に読んでもぶつからない）
function liveScoreKey_(l, sid) { return 'lvs:' + l.id + ':' + String(l.started || '').replace(/[^0-9]/g, '').slice(0, 14) + ':' + sid; }
SheetStore.prototype.getLiveScores = function (l, sids) {
  var c = sc_(), out = {}; if (!c || !sids.length) return out;
  var keys = sids.map(function (sid) { return liveScoreKey_(l, sid); }), got = {};
  for (var i = 0; i < keys.length; i += 100) { try { var g = c.getAll(keys.slice(i, i + 100)) || {}; for (var k in g) got[k] = g[k]; } catch (e) { /* noop */ } }
  sids.forEach(function (sid, j) { var v = got[keys[j]]; if (v) { try { out[sid] = JSON.parse(v); } catch (e) { /* noop */ } } });
  return out;
};
SheetStore.prototype.setLiveScore = function (l, sid, e) {
  var c = sc_(); if (!c) throw new Error('ライブのポイントを一時保存できませんでした。もう一度ためしてください。');
  c.put(liveScoreKey_(l, sid), JSON.stringify(e), LIVE_TTL_);
};
SheetStore.prototype.getLives = function () { return this.liveList_().filter(function (x) { return x.id; }); };
SheetStore.prototype.addLive = function (x) { var o = {}; for (var k in x) o[k] = x[k]; this.liveList_().push(o); this.liveSave_(); };
SheetStore.prototype.updateLive = function (id, f) {
  var l = this.liveList_();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { for (var k in f) l[i][k] = f[k]; }
  this.liveSave_();
};
SheetStore.prototype.deleteLive = function (id) {
  this.livesMem_ = this.liveList_().filter(function (x) { return String(x.id) !== id; });
  this.liveSave_();
};

// 課題フォルダ
SheetStore.prototype.getFolders = function () { return this.load('folders').filter(function (x) { return x.id; }); };
SheetStore.prototype.addFolder = function (x) { this.writeRow('folders', x); this.load('folders').push(x); };
SheetStore.prototype.updateFolder = function (id, f) {
  var l = this.getFolders();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { for (var k in f) l[i][k] = f[k]; this.writeRow('folders', l[i]); }
};
SheetStore.prototype.deleteFolder = function (id) {
  var l = this.getFolders();
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { this.delRow_('folders', l[i]._row); return; }
};

// 課題
SheetStore.prototype.getAssignments = function () {
  return this.load('assignments').filter(function (a) { return a.id; });
};
SheetStore.prototype.getAssignment = function (id) {
  var l = this.getAssignments();
  for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
};
SheetStore.prototype.addAssignment = function (a) { this.writeRow('assignments', a); this.load('assignments').push(a); };
SheetStore.prototype.updateAssignment = function (id, f) {
  var a = this.getAssignment(id); if (!a) return;
  for (var k in f) a[k] = f[k];
  this.writeRow('assignments', a);
};
SheetStore.prototype.deleteAssignment = function (id) {
  var a = this.getAssignment(id); if (!a) return;
  this.delRow_('assignments', a._row);
};

// 課題別ベスト
SheetStore.prototype.getAllBests = function () { return this.load('bests').filter(function (b) { return b.sid && b.aid; }); };
SheetStore.prototype.getBest = function (sid, aid) {
  var l = this.getAllBests();
  for (var i = 0; i < l.length; i++) if (l[i].sid === sid && l[i].aid === aid) return l[i];
  return null;
};
SheetStore.prototype.setBest = function (sid, aid, f) {
  var b = this.getBest(sid, aid);
  if (!b) { b = { sid: sid, aid: aid }; this.load('bests').push(b); }
  for (var k in f) b[k] = f[k];
  this.writeRow('bests', b);
};
SheetStore.prototype.getBestsByAssignment = function (aid) {
  return this.getAllBests().filter(function (b) { return b.aid === aid; });
};

// 記録（多くなるので下から必要な分だけ読む）
SheetStore.prototype.appendRecord = function (r) { this.writeRow('records', r); };
SheetStore.prototype.scanRecords_ = function (fn, maxRows) {
  var sh = this.sheet('records'), cols = SHEETS.records.cols, last = sh.getLastRow();
  var CH = 1000, scanned = 0, end = last;
  while (end >= 2 && scanned < maxRows) {
    var start = Math.max(2, end - CH + 1);
    var vals = sh.getRange(start, 1, end - start + 1, cols.length).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var o = { _row: start + i };
      for (var j = 0; j < cols.length; j++) o[cols[j][0]] = fmtCell_(vals[i][j], cols[j][0]);
      if (fn(o) === false) return;
    }
    scanned += vals.length;
    end = start - 1;
  }
};
SheetStore.prototype.getFlaggedRecords = function (since) {
  var out = [];
  this.scanRecords_(function (r) {
    if (r.date && String(r.date) < since) return false;
    if (r.flag) out.push(r);
    return true;
  }, 200000);
  return out;
};
SheetStore.prototype.findRecord = function (rid) {
  var found = null, i = rid.lastIndexOf('|'), time = rid.slice(0, i), sid = rid.slice(i + 1);
  this.scanRecords_(function (r) {
    if (r.time === time && r.sid === sid) { found = r; return false; }
    return true;
  }, 200000);
  return found;
};
SheetStore.prototype.updateRecord = function (rid, f) {
  var r = this.findRecord(rid); if (!r) return;
  var sh = this.sheet('records'), cols = SHEETS.records.cols;
  cols.forEach(function (c, j) { if (c[0] in f) sh.getRange(r._row, j + 1).setValue(f[c[0]]); });
};
SheetStore.prototype.getRecordsSince = function (date) {
  var out = [];
  this.scanRecords_(function (r) {
    if (!r.date) return true;
    if (String(r.date) < date) return false;
    out.push(r); return true;
  }, 200000);
  return out;
};
SheetStore.prototype.getRecordsByStudent = function (sid, limit) {
  var out = [];
  this.scanRecords_(function (r) {
    if (r.sid === sid) out.push(r);
    return out.length < limit;
  }, 30000);
  return out;
};

// 先生
SheetStore.prototype.getTeachers = function () {
  return this.load('teachers').filter(function (t) { return String(t.id).trim(); })
    .map(function (t) { t.id = String(t.id).trim().toLowerCase(); return t; });
};
SheetStore.prototype.getTeacher = function (id) {
  id = String(id).toLowerCase();
  var l = this.getTeachers();
  for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
};
SheetStore.prototype.addTeacher = function (t) { this.writeRow('teachers', t); this.load('teachers').push(t); };
SheetStore.prototype.updateTeacher = function (id, f) {
  var t = this.getTeacher(id); if (!t) return;
  for (var k in f) t[k] = f[k];
  this.writeRow('teachers', t);
};
SheetStore.prototype.deleteTeacher = function (id) {
  var t = this.getTeacher(id); if (!t) return;
  this.delRow_('teachers', t._row);
};
// クラス
SheetStore.prototype.getClasses = function () {
  return this.load('classes').filter(function (c) { return String(c.name).trim(); })
    .map(function (c) { c.name = String(c.name).trim(); return c; });
};
SheetStore.prototype.setClass = function (name, count) {
  var l = this.getClasses();
  for (var i = 0; i < l.length; i++) if (l[i].name === name) { l[i].count = count; this.writeRow('classes', l[i]); return; }
  var c = { name: name, count: count };
  this.writeRow('classes', c); this.load('classes').push(c);
};
SheetStore.prototype.deleteClass = function (name) {
  var l = this.getClasses();
  for (var i = 0; i < l.length; i++) if (l[i].name === name) { this.delRow_('classes', l[i]._row); return; }
};
SheetStore.prototype.deleteStudent = function (id) {
  var s = this.getStudent(id); if (!s) return;
  this.delRow_('students', s._row);
};

// 設定
SheetStore.prototype.getSetting = function (k) {
  var l = this.load('settings');
  for (var i = 0; i < l.length; i++) if (String(l[i].key).trim() === k) return l[i].value;
  return '';
};
SheetStore.prototype.setSetting = function (k, v) {
  var l = this.load('settings');
  for (var i = 0; i < l.length; i++) if (String(l[i].key).trim() === k) { l[i].value = v; this.writeRow('settings', l[i]); return; }
  var o = { key: k, value: v, note: '' };
  this.writeRow('settings', o); l.push(o);
};

// 音声（Googleドライブのフォルダ「音読アプリ_音声」に保存）
function audioFolder_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('AUDIO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 作り直す */ } }
  var f = DriveApp.createFolder('音読アプリ_音声');
  p.setProperty('AUDIO_FOLDER_ID', f.getId());
  return f;
}
SheetStore.prototype.saveAudio = function (a) {
  var ext = /mp4|aac|m4a/.test(a.mime) ? '.m4a' : /ogg/.test(a.mime) ? '.ogg' : '.webm';
  var blob = Utilities.newBlob(Utilities.base64Decode(a.b64), a.mime.split(';')[0], a.name + ext);
  return audioFolder_().createFile(blob).getId();
};
SheetStore.prototype.getAudio = function (id) {
  if (!id) return null;
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { return null; }
  if (file.isTrashed()) return null;
  var blob = file.getBlob();
  return { mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
};

/* ---------- 署名など ---------- */
function secret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}
var GAS_CTX = {
  now: function () { return new Date(); },
  sign: function (s) {
    return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())).replace(/=+$/, '');
  },
  b64: function (s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); },
  unb64: function (s) {
    while (s.length % 4) s += '=';
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString('UTF-8');
  },
  translate: function (text) { return LanguageApp.translate(text, 'en', 'ja'); },
  cacheGet: function (k) { return CacheService.getScriptCache().get(k); },
  cachePut: function (k, v, sec) { CacheService.getScriptCache().put(k, v, sec); }
};

/* ---------- 入口（ウェブアプリ） ---------- */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return json_({ ok: true, message: '音読アプリのサーバーは動いています。' });
}
function doPost(e) {
  var t0 = Date.now(), req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'リクエストが正しくありません。' }); }
  var action = String(req.action || ''), payload = req.payload || {};
  var lock = null, write = !!Core.WRITE_ACTIONS[action];
  if (payload && typeof payload === 'object') delete payload._audioId;
  // ライブ中の音読：順番待ちなし・スプレッドシートを開かずに処理する（ポイントは生徒ごとにキャッシュへ）
  if (action === 'submit' && payload.aid) {
    var qs = new SheetStore({ request: true }), isLive = false;
    try { isLive = Core.isLiveSubmit(payload, qs, GAS_CTX); } catch (err) { isLive = false; }
    if (isLive) {
      delete payload.audio;
      try {
        var lr = Core.handle(action, payload, qs, GAS_CTX);
        lr._ms = Date.now() - t0; lr._sheet = !!qs._book; lr._live = true;
        return json_(lr);
      } catch (err) { return json_({ ok: false, error: 'サーバーでエラーが発生しました：' + err.message }); }
    }
  }
  // 録音の保存（Googleドライブ）は時間がかかるので、順番待ち（ロック）の前に済ませておく
  if (action === 'submit' && payload.audio) {
    try { Core.preSubmit(payload, new SheetStore({ request: true }), GAS_CTX); } catch (err) { /* 本処理でもう一度確認されます */ }
  }
  if (write) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return json_({ ok: false, busy: true, error: '混み合っています。少し待ってからもう一度ためしてください。' });
  }
  try {
    // 書き込む処理は、書き換える可能性のあるシートを必ずシートから読む（生徒の操作は「生徒」「課題別ベスト」「アバター画像」だけ。ライブはキャッシュ）
    var fresh = !write ? null : (/^t_/.test(action) || action === 'teacherLogin') ? true : { students: 1, bests: 1, pics: 1 };
    var store = new SheetStore({ fresh: fresh, request: true });
    var res = Core.handle(action, payload, store, GAS_CTX);
    if (lock) { SpreadsheetApp.flush(); store.publishCache_(); }
    res._ms = Date.now() - t0; res._sheet = !!store._book; // 処理時間とスプレッドシートを開いたか（速さの確認用）
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: 'サーバーでエラーが発生しました：' + err.message });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ---------- スプレッドシートのメニュー ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('音読アプリ')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('サンプル課題を追加', 'addSampleAssignment')
    .addItem('管理者のパスワードを再発行', 'resetAdminPassword')
    .addItem('古い音声を削除', 'cleanupOldAudio')
    .addItem('アプリの表示を最新にする（キャッシュを消す）', 'clearAppCache')
    .addToUi();
}
// シートを手で編集したら、そのシートのキャッシュを古いものとして扱う（シンプルトリガー）
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    CACHED_SHEETS_.forEach(function (k) { if (SHEETS[k].name === name) cacheBump_(k); });
  } catch (err) { /* noop */ }
}
function clearAppCache() {
  cacheClearAll_();
  try { SpreadsheetApp.getUi().alert('キャッシュを消しました。アプリに最新の内容が表示されます。'); } catch (e) { /* noop */ }
}

function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', book.getId());
  secret_();
  audioFolder_(); // 音声保存用フォルダ（ここでドライブの許可も求められます）
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k], sh = book.getSheetByName(def.name);
    if (!sh) sh = book.insertSheet(def.name);
    var head = sh.getRange(1, 1, 1, def.cols.length);
    head.setValues([def.cols.map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e3f1f6');
    sh.setFrozenRows(1);
    def.cols.forEach(function (c, i) {
      var rng = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      // 値を入れずにチェックボックスの形式だけを設定（空行を増やさないため）
      if (c[2] === 'check') rng.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      else rng.setNumberFormat(c[2]);
    });
  });
  // 設定の初期値
  var st = book.getSheetByName(SHEETS.settings.name);
  var existing = st.getLastRow() >= 2 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  var pass = '';
  DEFAULT_SETTINGS.forEach(function (d) {
    if (existing.indexOf(d[0]) >= 0) return;
    st.appendRow([d[0], d[1], d[2]]);
  });
  // 管理者アカウント（先生が1人もいないときだけ作る。旧版の「先生パスワード」があればそれを使う）
  var store = new SheetStore({ fresh: true });
  if (!store.getTeachers().length) {
    var legacy = String(store.getSetting('先生パスワード') || '');
    pass = legacy || ('ondoku' + Math.floor(1000 + Math.random() * 9000));
    store.addTeacher({ id: 'admin', name: '管理者', pass: Core.hashPass('admin', pass), role: 'admin', classes: '', active: true,
      created: new Date().toISOString() });
  }
  st.setColumnWidth(1, 160); st.setColumnWidth(2, 200); st.setColumnWidth(3, 420);
  // 使わない初期シートを片付け
  var s1 = book.getSheetByName('シート1') || book.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(s1);
  // 生徒シートに例を1行
  var stu = book.getSheetByName(SHEETS.students.name);
  if (stu.getLastRow() < 2) stu.appendRow(['1A', 1, '（例）青木 葵', '1234', '', 0, 0, 0, '', '', 0]);
  cacheClearAll_();
  var msg = '初期設定が完了しました。\n\n' + (pass ? '管理者のログインID：admin\nパスワード：' + pass + '\n（ログイン後、先生用画面の「設定」で変更できます）\n\n' : '') +
    '次に「生徒」シートに名簿（クラス・番号・名前・パスコード）を入力し、\nApps Script の「デプロイ」→「新しいデプロイ」でウェブアプリとして公開してください。';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function addSampleAssignment() {
  var store = new SheetStore({ fresh: true });
  var text = "Reading aloud is a simple way to improve your English. When you read aloud, you use your eyes, your mouth, and your ears at the same time. Let's enjoy reading aloud together!";
  store.addAssignment({ id: 'A' + new Date().getTime().toString(36).toUpperCase(), title: 'サンプル：Reading Aloud', text: text,
    ja: '音読は英語力を伸ばすシンプルな方法です。音読するとき、目と口と耳を同時に使います。いっしょに音読を楽しみましょう！',
    classes: '', due: '', contest: false, published: true, created: new Date().toISOString(), words: Scoring.countWords(text) });
  try { SpreadsheetApp.getUi().alert('サンプル課題を追加しました。'); } catch (e) { /* noop */ }
}

function cleanupOldAudio() {
  var days = Number(new SheetStore({ fresh: true }).getSetting('音声の保存日数')) || 60;
  var limit = new Date(Date.now() - days * 86400000);
  var files = audioFolder_().getFiles(), n = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() < limit) { f.setTrashed(true); n++; }
  }
  try { SpreadsheetApp.getUi().alert(days + '日より古い音声を ' + n + ' 件、ゴミ箱に移しました。'); } catch (e) { Logger.log(n); }
}

function resetAdminPassword() {
  var store = new SheetStore({ fresh: true });
  var admins = store.getTeachers().filter(function (t) { return String(t.role) === 'admin'; });
  var id = admins.length ? admins[0].id : 'admin';
  var pw = 'ondoku' + Math.floor(1000 + Math.random() * 9000);
  if (admins.length) store.updateTeacher(id, { pass: Core.hashPass(id, pw), active: true });
  else store.addTeacher({ id: id, name: '管理者', pass: Core.hashPass(id, pw), role: 'admin', classes: '', active: true, created: new Date().toISOString() });
  SpreadsheetApp.getUi().alert('管理者のログインID：' + id + '\n新しいパスワード：' + pw);
}
