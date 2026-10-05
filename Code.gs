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

  function tokenize(text) {
    var tokens = [];
    var src = String(text || '').replace(/\r/g, '');
    var lineJa = src.split('\n').map(isJaLine), li = 0;
    src.split(/(\s+)/).forEach(function (part) {
      if (part === '') return;
      if (/^\s+$/.test(part)) { tokens.push({ text: part, space: true, units: [] }); li += (part.match(/\n/g) || []).length; return; }
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
      return line.split(JA_RE).filter(function (seg) { return seg && !JA_TEST.test(seg); }).join(' ')
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

  var api = { isJaLine: isJaLine, score: score, scoreWithPhrase: scoreWithPhrase, phraseTokens: phraseTokens,
    makePhrase: makePhrase, phrasePosition: phrasePosition, tokenize: tokenize, englishOnly: englishOnly, toUnits: toUnits, countWords: countWords,
    numberToWords: numberToWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

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
    { id: 'daikichi', icon: '🎊', name: '大吉', desc: 'おみくじで大吉を引いて読んだ', hidden: true },
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
      id: s.id, cls: s.cls, no: s.no, nick: str(s.nick),
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
    o.p = num(o.p); o.d = num(o.d);
    return o;
  }
  function rewardsPublic(ach, s, today) {
    var lv = levelOf(num(s.totalWords));
    return { points: ach.p, badges: ach.b, days: ach.d, stampedToday: ach.ld === today, theme: ach.th || 'blue', icon: ach.ic || '',
      weekDays: ach.wk === weekStart(today) ? num(ach.wd) : 0, read: ach.lib, counts: ach.c,
      stamps: ach.st.slice(-40), newStamps: ach.st.filter(function (x) { return x.n; }).length,
      icons: iconsUnlocked(lv.index, ach.d), levelIndex: lv.index };
  }
  function stampRulesOn(store) {
    var v = str(store.getSetting('自動スタンプ'));
    if (!v) return STAMP_RULES.map(function (r) { return r.id; });
    if (v === 'なし') return [];
    return v.split(/[,、\s]+/).filter(Boolean);
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
    return { token: token, student: studentPublic(s) };
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
          achieved: pg.achieved, totalPasses: pg.totalPasses, need: pg.need
        };
      });
    list.sort(function (x, y) { return (y.created || '').localeCompare(x.created || ''); });
    var pub = studentPublic(s);
    if (pub.todayDate !== today) pub.todayWords = 0;
    if (pub.lastDate && pub.lastDate < addDays(today, -1)) pub.streak = 0;
    return { student: pub, assignments: list, settings: settingsForClient(store), today: today, rewards: rewardsPublic(achOf(s), s, today) };
  };

  handlers.getAssignment = function (p, store, ctx) {
    var s = currentStudent(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a || !assignmentVisibleTo(a, s)) throw err('この課題は見つかりません。');
    var b = store.getBest(s.id, a.id);
    var pg = progress(store, s.id, a);
    return {
      assignment: { id: a.id, title: a.title, text: a.text, ja: str(a.ja), due: str(a.due), contest: bool(a.contest),
        types: pg.types, mode: isMaster(a) ? 'master' : 'normal', pass: pg.pass, blanks: str(a.blanks) },
      best: b ? num(b.best) : null, attempts: pg.attempts, progress: pg
    };
  };

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

    // 音声の保存（先生が確認できるように）
    var audioId = '';
    if (cfg.saveAudio && p.audio && p.audio.b64 && store.saveAudio && String(p.audio.b64).length < 4000000) {
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
    award('daikichi', p.kind === 'omikuji' && str(p.fortune) === '大吉' && r.accuracy >= 60);
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
    var on = stampRulesOn(store);
    function stamp(ruleId, key, cond) {
      if (!cond || on.indexOf(ruleId) < 0 || ach.sk[key]) return;
      var rule = STAMP_RULES.filter(function (x) { return x.id === ruleId; })[0];
      ach.sk[key] = 1;
      ach.st.push({ a: rule.a, t: rule.t, r: ruleId, d: today, n: 1 });
      newStamps.push({ a: rule.a, t: rule.t, r: ruleId });
    }
    stamp('first', 'first', firstEver && r.correct > 0);
    stamp('week3', 'w3:' + ws, newDay && ach.wd === 3);
    stamp('week5', 'w5:' + ws, newDay && ach.wd === 5);
    stamp('week7', 'w7:' + ws, newDay && ach.wd === 7);
    stamp('achieve', 'a:' + aid, achievedNew);
    stamp('perfect', 'pf:' + ws, r.accuracy >= 100);
    stamp('comeback', 'cb:' + today, comeback);
    award('teacher', ach.st.length >= 1);
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
      newBadges: newBadges, newStamps: newStamps, bonus: bonus, rewards: rewardsPublic(ach, s, today)
    };
  };

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
      return { id: x.id, name: displayName(x, allowNick), words: score[x.id] || 0, level: levelOf(num(x.totalWords)).name };
    }).sort(function (a, b) { return b.words - a.words; });
    var rank = 0, prev = -1, mine = null;
    list.forEach(function (x, i) {
      if (x.words !== prev) { rank = i + 1; prev = x.words; }
      x.rank = rank;
      x.me = x.id === s.id;
      if (x.me) mine = { rank: x.rank, words: x.words };
    });
    var top = list.slice(0, 30).map(function (x) { return { rank: x.rank, name: x.name, words: x.words, level: x.level, me: x.me }; });
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
      .map(function (b) { return { sid: b.sid, name: displayName(byId[b.sid], allowNick), best: num(b.best), at: str(b.bestAt) }; })
      .sort(function (x, y) { return y.best - x.best || x.at.localeCompare(y.at); });
    var mine = null;
    list.forEach(function (x, i) {
      x.rank = (i > 0 && list[i - 1].best === x.best) ? list[i - 1].rank : i + 1;
      x.me = x.sid === s.id;
      if (x.me) mine = { rank: x.rank, best: x.best };
    });
    return {
      title: a.title, due: str(a.due), mine: mine, count: list.length,
      list: list.slice(0, 30).map(function (x) { return { rank: x.rank, name: x.name, best: x.best, me: x.me }; })
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
        targets: targets.length, done: done, avg: avg, passCount: passNeed(a)
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
      if (pub.lastDate && pub.lastDate < addDays(today, -1)) pub.streak = 0;
      return pub;
    });
    var settings = settingsForClient(store);
    return { assignments: assignments, students: list, classes: classList(store).map(function (c) { return c.name; }), today: today, settings: settings,
      openFlags: openFlags(store, today), me: me };
  };

  handlers.t_getAssignment = function (p, store, ctx) {
    var me = currentTeacher(p, store, ctx);
    var a = store.getAssignment(str(p.aid));
    if (!a) throw err('課題が見つかりません。');
    return { assignment: {
      id: a.id, title: a.title, text: a.text, ja: str(a.ja), classes: str(a.classes),
      due: str(a.due), contest: bool(a.contest), published: bool(a.published),
      types: aTypes(a), mode: isMaster(a) ? 'master' : 'normal', pass: passLine(a), passCount: passNeed(a), blanks: str(a.blanks),
      start: str(a.start), canEdit: canEditAssignment(me, a)
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
    var pub = studentPublic(s); pub.name = str(s.name);
    return { student: pub, records: recs, rewards: rewardsPublic(achOf(s), s, jstDate(ctx.now())) };
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
    return { count: openFlags(store, jstDate(ctx.now())) };
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

  var WRITE_ACTIONS = { submit: 1, setNick: 1, setLook: 1, seenStamps: 1, t_saveLibrary: 1, t_deleteLibrary: 1, t_hideLibrary: 1, t_saveAssignment: 1, t_deleteAssignment: 1,
    t_importStudents: 1, t_saveSettings: 1, t_reviewFlag: 1, t_changePassword: 1, t_saveTeacher: 1,
    t_resetTeacherPass: 1, t_deleteTeacher: 1, t_saveClass: 1, t_deleteClass: 1, teacherLogin: 1 };

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
    weekStart: weekStart, WRITE_ACTIONS: WRITE_ACTIONS,
    BADGES: BADGES, STAMP_RULES: STAMP_RULES, THEMES: THEMES };
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
    ['types', '音読の種類', '@'], ['mode', 'モード', '@'], ['blanks', '穴あき位置', '@'], ['pass', '合格ライン', '0'], ['owner', '作成した先生', '@'], ['start', '開始日時', '@'], ['passCount', '合格回数', '0']] },
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
    ['text', '英文', '@'], ['ja', '和訳', '@'], ['owner', '作成した先生', '@'], ['created', '作成日時', '@']] }
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
  ['ライブラリ非表示', '', '生徒に表示しない、最初から入っているライブラリ英文のID']
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

/* ---------- 保存先（store） ---------- */
function SheetStore() { this.cache = {}; this.book = ss_(); }

SheetStore.prototype.sheet = function (k) {
  var sh = this.book.getSheetByName(SHEETS[k].name);
  if (!sh && k === 'library') {
    // あとから追加したシートは、なければ自動で作る
    sh = this.book.insertSheet(SHEETS[k].name);
    sh.getRange(1, 1, 1, SHEETS[k].cols.length).setValues([SHEETS[k].cols.map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e3f1f6');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('「' + SHEETS[k].name + '」シートがありません。メニューの「音読アプリ」→「初期設定」を実行してください。');
  return sh;
};
// シート全体を読み込み（小さいシート用）
SheetStore.prototype.load = function (k) {
  if (this.cache[k]) return this.cache[k];
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
  this.cache[k] = rows;
  return rows;
};
SheetStore.prototype.writeRow = function (k, obj) {
  var cols = SHEETS[k].cols, sh = this.sheet(k);
  var row = cols.map(function (c) { var v = obj[c[0]]; return v === undefined || v === null ? '' : v; });
  if (obj._row) sh.getRange(obj._row, 1, 1, cols.length).setValues([row]);
  else { sh.appendRow(row); obj._row = sh.getLastRow(); }
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
  for (var i = 0; i < l.length; i++) if (String(l[i].id) === id) { this.sheet('library').deleteRow(l[i]._row); this.cache.library = null; return; }
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
  this.sheet('assignments').deleteRow(a._row);
  this.cache.assignments = null;
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
  this.sheet('teachers').deleteRow(t._row);
  this.cache.teachers = null;
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
  for (var i = 0; i < l.length; i++) if (l[i].name === name) { this.sheet('classes').deleteRow(l[i]._row); this.cache.classes = null; return; }
};
SheetStore.prototype.deleteStudent = function (id) {
  var s = this.getStudent(id); if (!s) return;
  this.sheet('students').deleteRow(s._row);
  this.cache.students = null;
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
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'リクエストが正しくありません。' }); }
  var action = String(req.action || '');
  var lock = null;
  if (Core.WRITE_ACTIONS[action]) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, busy: true, error: '混み合っています。少し待ってからもう一度ためしてください。' });
  }
  try {
    var res = Core.handle(action, req.payload || {}, new SheetStore(), GAS_CTX);
    if (lock) SpreadsheetApp.flush();
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
    .addToUi();
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
  var store = new SheetStore();
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
  var msg = '初期設定が完了しました。\n\n' + (pass ? '管理者のログインID：admin\nパスワード：' + pass + '\n（ログイン後、先生用画面の「設定」で変更できます）\n\n' : '') +
    '次に「生徒」シートに名簿（クラス・番号・名前・パスコード）を入力し、\nApps Script の「デプロイ」→「新しいデプロイ」でウェブアプリとして公開してください。';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function addSampleAssignment() {
  var store = new SheetStore();
  var text = "Reading aloud is a simple way to improve your English. When you read aloud, you use your eyes, your mouth, and your ears at the same time. Let's enjoy reading aloud together!";
  store.addAssignment({ id: 'A' + new Date().getTime().toString(36).toUpperCase(), title: 'サンプル：Reading Aloud', text: text,
    ja: '音読は英語力を伸ばすシンプルな方法です。音読するとき、目と口と耳を同時に使います。いっしょに音読を楽しみましょう！',
    classes: '', due: '', contest: false, published: true, created: new Date().toISOString(), words: Scoring.countWords(text) });
  try { SpreadsheetApp.getUi().alert('サンプル課題を追加しました。'); } catch (e) { /* noop */ }
}

function cleanupOldAudio() {
  var days = Number(new SheetStore().getSetting('音声の保存日数')) || 60;
  var limit = new Date(Date.now() - days * 86400000);
  var files = audioFolder_().getFiles(), n = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() < limit) { f.setTrashed(true); n++; }
  }
  try { SpreadsheetApp.getUi().alert(days + '日より古い音声を ' + n + ' 件、ゴミ箱に移しました。'); } catch (e) { Logger.log(n); }
}

function resetAdminPassword() {
  var store = new SheetStore();
  var admins = store.getTeachers().filter(function (t) { return String(t.role) === 'admin'; });
  var id = admins.length ? admins[0].id : 'admin';
  var pw = 'ondoku' + Math.floor(1000 + Math.random() * 9000);
  if (admins.length) store.updateTeacher(id, { pass: Core.hashPass(id, pw), active: true });
  else store.addTeacher({ id: id, name: '管理者', pass: Core.hashPass(id, pw), role: 'admin', classes: '', active: true, created: new Date().toISOString() });
  SpreadsheetApp.getUi().alert('管理者のログインID：' + id + '\n新しいパスワード：' + pw);
}
