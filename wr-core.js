/* =========================================================
 * ワイルドローバーズ 共通計算ロジック (wr-core.js)
 * 閲覧画面(index.html)・管理画面(admin.html)・テスト(tests/test.html)
 * のすべてがこのファイルの計算を使うため、成績とランキングが常に一致します。
 * ========================================================= */
(function (root) {
  'use strict';

  var POSITIONS = ['投手', '捕手', '一塁手', '二塁手', '三塁手', '遊撃手', '左翼手', '中堅手', '右翼手', '指名打者', '控え'];

  // 打撃・投手・守備の入力項目（key: 保存名, label: 表示名）
  var BAT_FIELDS = [
    { key: 'PA', label: '打席' }, { key: 'AB', label: '打数' }, { key: 'H', label: '安打' },
    { key: 'D', label: '二塁打' }, { key: 'T', label: '三塁打' }, { key: 'HR', label: '本塁打' },
    { key: 'RBI', label: '打点' }, { key: 'R', label: '得点' }, { key: 'SB', label: '盗塁' },
    { key: 'BB', label: '四球' }, { key: 'HBP', label: '死球' }, { key: 'SF', label: '犠飛' },
    { key: 'SH', label: '犠打' }, { key: 'SO', label: '三振' }
  ];
  var PIT_FIELDS = [
    { key: 'IP', label: '投球回' }, { key: 'W', label: '勝' }, { key: 'L', label: '敗' },
    { key: 'SV', label: 'S' }, { key: 'SO', label: '奪三振' }, { key: 'BB', label: '与四球' },
    { key: 'H', label: '被安打' }, { key: 'R', label: '失点' }, { key: 'ER', label: '自責点' }
  ];
  var FLD_FIELDS = [
    { key: 'PO', label: '刺殺' }, { key: 'A', label: '補殺' }, { key: 'E', label: '失策' }
  ];

  var DEFAULT_SETTINGS = {
    currentSeason: String(new Date().getFullYear()),
    seasons: [String(new Date().getFullYear())],
    qualifyPAPerGame: 2.0,   // 規定打席 = チーム試合数 × この数
    qualifyIPPerGame: 1.0,   // 規定投球回 = チーム試合数 × この数（回）
    qualifyIPFixed: null,    // 規定投球回を固定値にする場合の回数（null なら 試合数×qualifyIPPerGame）
    eraInnings: 9,           // 防御率の換算イニング（プロ野球の標準は9）
    // 試合MVP・準MVPに自動で付けるWP（大会 / 練習試合）
    wpRules: { tour: { mvp: 2000, mvp2: 1000 }, prac: { mvp: 1000, mvp2: 500 } }
  };

  /* ---------- 基本ユーティリティ ---------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(prefix) {
    return (prefix || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function normText(s) { return String(s == null ? '' : s).replace(/[\s　]+/g, '').toLowerCase(); }

  // 入力欄の文字 → 数値 or null（空欄は「未登録」= null。勝手に0にしない）
  function toNumOrNull(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(/[０-９．－]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /* ---------- 投球回: 野球式表記 "5.2" = 5回2/3 をアウト数で保存 ---------- */
  function ipToOuts(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var s = String(v).trim();
    var m = s.match(/^(\d+)(?:\.(\d))?$/);
    if (!m) {
      // "5 2/3" 形式にも対応
      var f = s.match(/^(\d+)\s+([12])\/3$/);
      if (f) return Number(f[1]) * 3 + Number(f[2]);
      var f2 = s.match(/^([12])\/3$/);
      if (f2) return Number(f2[1]);
      return NaN;
    }
    var frac = m[2] ? Number(m[2]) : 0;
    if (frac > 2) return NaN;
    return Number(m[1]) * 3 + frac;
  }
  function outsToIP(outs) {
    if (!isNum(outs)) return null;
    return Math.floor(outs / 3) + '.' + (outs % 3);
  }
  function outsToIPText(outs) {
    if (!isNum(outs)) return '未登録';
    var w = Math.floor(outs / 3), r = outs % 3;
    if (r === 0) return w + '回';
    return (w > 0 ? w + '回' : '') + r + '/3';
  }

  /* ---------- 表示フォーマット ---------- */
  function fmtRate3(v) { // 打率など .333 形式
    if (!isNum(v)) return '—';
    var s = v.toFixed(3);
    return s.charAt(0) === '0' ? s.slice(1) : s;
  }
  function fmt2(v) { return isNum(v) ? v.toFixed(2) : '—'; }

  /* ---------- データの初期化・検証 ---------- */
  function emptyData() {
    return {
      players: { players: [] },
      stats: { batting: [], pitching: [], fielding: [] },
      games: { games: [] },
      rankings: { settings: clone(DEFAULT_SETTINGS), wp: [], mvpAwards: [], trophies: [] }
    };
  }

  // 読み込んだデータを安全な形に整え、二重登録を取り除く
  function normalize(raw) {
    var d = emptyData();
    var warnings = [];
    raw = raw || {};
    if (raw.players && Array.isArray(raw.players.players)) d.players = raw.players;
    if (raw.stats) {
      d.stats.batting = Array.isArray(raw.stats.batting) ? raw.stats.batting : [];
      d.stats.pitching = Array.isArray(raw.stats.pitching) ? raw.stats.pitching : [];
      d.stats.fielding = Array.isArray(raw.stats.fielding) ? raw.stats.fielding : [];
      Object.keys(raw.stats).forEach(function (k) { if (k.charAt(0) === '_') d.stats[k] = raw.stats[k]; });
    }
    if (raw.games && Array.isArray(raw.games.games)) d.games = raw.games;
    if (raw.rankings) {
      var r = raw.rankings;
      d.rankings = r;
      r.settings = Object.assign(clone(DEFAULT_SETTINGS), r.settings || {});
      r.wp = Array.isArray(r.wp) ? r.wp : [];
      r.mvpAwards = Array.isArray(r.mvpAwards) ? r.mvpAwards : [];
      r.trophies = Array.isArray(r.trophies) ? r.trophies : [];
    }
    var s = d.rankings.settings;
    if (!Array.isArray(s.seasons) || !s.seasons.length) s.seasons = [s.currentSeason];
    if (s.seasons.indexOf(s.currentSeason) < 0) s.seasons.push(s.currentSeason);

    // 試合の重複（同じ日・同じ相手・同じ試合番号）を除去
    var seenGame = {}, gamesOut = [];
    d.games.games.forEach(function (g) {
      var k = gameKey(g);
      if (seenGame[k]) { warnings.push('重複した試合を除外しました: ' + g.date + ' vs ' + g.opponent); return; }
      seenGame[k] = true; gamesOut.push(g);
    });
    d.games.games = gamesOut;
    d.games.games.forEach(function (g) {
      if (!g.season) g.season = String(g.date || '').slice(0, 4) || s.currentSeason;
      if (s.seasons.indexOf(String(g.season)) < 0) s.seasons.push(String(g.season));
    });
    s.seasons.sort();

    // 同じ試合×同じ選手の成績行が複数あれば、後のもの1つだけ残す（二重集計防止）
    ['batting', 'pitching', 'fielding'].forEach(function (type) {
      var map = {}, order = [];
      d.stats[type].forEach(function (row) {
        var k = row.gameId + '|' + row.playerId;
        if (map[k]) warnings.push('重複した' + type + '成績を1件にまとめました: ' + k);
        else order.push(k);
        map[k] = row;
      });
      d.stats[type] = order.map(function (k) { return map[k]; });
    });
    return { data: d, warnings: warnings };
  }

  /* ---------- 参照ヘルパー ---------- */
  function playerById(data, id) {
    var list = data.players.players;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function gameById(data, id) {
    var list = data.games.games;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function gameKey(g) {
    return String(g.date || '') + '|' + normText(g.opponent) + '|' + (g.gameNo || 1);
  }
  /* 集計範囲（スコープ）
   * season には「'2026'」のような年の文字列のほか、
   * { season: '2026', kind: 'tour' } のように試合の種類（tour=大会 / prac=練習試合 / all=全試合）も渡せます。
   * season が null なら全シーズン（通算）。 */
  function scopeOf(season) {
    if (season && typeof season === 'object') {
      return { season: season.season == null ? null : String(season.season), kind: season.kind && season.kind !== 'all' ? season.kind : null };
    }
    return { season: season == null ? null : String(season), kind: null };
  }
  function seasonGames(data, season) {
    var sc = scopeOf(season);
    return data.games.games.filter(function (g) {
      return (sc.season == null || String(g.season) === sc.season) && (!sc.kind || gameKind(g) === sc.kind);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.gameNo || 1) - (b.gameNo || 1); });
  }
  function seasonGameIdSet(data, season) {
    var set = {};
    seasonGames(data, season).forEach(function (g) { set[g.id] = true; });
    return set;
  }
  // 試合の種別（大会 / 練習試合）
  function gameKind(g) { return g.kind || (g.tourney ? 'tour' : 'prac'); }
  var GUEST = '__guest';

  function gameResult(g) {
    if (!isNum(g.scoreFor) || !isNum(g.scoreAgainst)) return null;
    if (g.scoreFor > g.scoreAgainst) return '勝';
    if (g.scoreFor < g.scoreAgainst) return '負';
    return '分';
  }
  function teamRecord(data, season) {
    var r = { G: 0, W: 0, L: 0, D: 0, RF: 0, RA: 0 };
    seasonGames(data, season).forEach(function (g) {
      var res = gameResult(g);
      if (!res) return;
      r.G++; r.RF += g.scoreFor; r.RA += g.scoreAgainst;
      if (res === '勝') r.W++; else if (res === '負') r.L++; else r.D++;
    });
    return r;
  }

  /* ---------- 集計：未登録はnull、登録済みの値だけを合計 ---------- */
  function sumFields(rows, keys) {
    var out = {};
    keys.forEach(function (k) {
      var total = null;
      rows.forEach(function (row) {
        if (isNum(row[k])) total = (total === null ? 0 : total) + row[k];
      });
      out[k] = total;
    });
    return out;
  }

  // 打撃成績（season=null なら通算）
  function aggregateBatting(data, playerId, season) {
    var ids = seasonGameIdSet(data, season);
    var rows = data.stats.batting.filter(function (r) { return r.playerId === playerId && ids[r.gameId]; });
    var keys = BAT_FIELDS.map(function (f) { return f.key; });
    var s = sumFields(rows, keys);
    s.G = rows.length;
    s.registered = rows.length > 0;
    var v = function (k) { return isNum(s[k]) ? s[k] : 0; };
    // 打率 = 安打 ÷ 打数
    s.AVG = (isNum(s.H) && isNum(s.AB) && s.AB > 0) ? s.H / s.AB : null;
    // 出塁率 = (安打+四球+死球) ÷ (打数+四球+死球+犠飛)  ※死球・犠飛が未登録の試合はその項目を数えない
    var obpDen = v('AB') + v('BB') + v('HBP') + v('SF');
    s.OBP = (isNum(s.H) && isNum(s.AB) && isNum(s.BB) && obpDen > 0) ? (v('H') + v('BB') + v('HBP')) / obpDen : null;
    // 長打率 = 塁打 ÷ 打数（塁打 = 単打 + 二塁打×2 + 三塁打×3 + 本塁打×4）
    if (isNum(s.H) && isNum(s.AB) && s.AB > 0) {
      var singles = v('H') - v('D') - v('T') - v('HR');
      s.TB = singles + v('D') * 2 + v('T') * 3 + v('HR') * 4;
      s.SLG = s.TB / s.AB;
    } else { s.TB = null; s.SLG = null; }
    // OPS = 出塁率 + 長打率
    s.OPS = (isNum(s.OBP) && isNum(s.SLG)) ? s.OBP + s.SLG : null;
    return s;
  }

  // 投手成績
  function aggregatePitching(data, playerId, season) {
    var ids = seasonGameIdSet(data, season);
    var rows = data.stats.pitching.filter(function (r) { return r.playerId === playerId && ids[r.gameId]; });
    var keys = ['outs', 'W', 'L', 'SV', 'SO', 'BB', 'H', 'R', 'ER'];
    var s = sumFields(rows, keys);
    s.G = rows.length;
    s.registered = rows.length > 0;
    var eraInn = Number(data.rankings.settings.eraInnings) || 9;
    // 防御率 = 自責点 × 9 ÷ 投球回
    s.ERA = (isNum(s.ER) && isNum(s.outs) && s.outs > 0) ? s.ER * eraInn / (s.outs / 3) : null;
    // WHIP = (与四球 + 被安打) ÷ 投球回
    s.WHIP = (isNum(s.BB) && isNum(s.H) && isNum(s.outs) && s.outs > 0) ? (s.BB + s.H) / (s.outs / 3) : null;
    return s;
  }

  // 守備成績
  function aggregateFielding(data, playerId, season) {
    var ids = seasonGameIdSet(data, season);
    var rows = data.stats.fielding.filter(function (r) { return r.playerId === playerId && ids[r.gameId]; });
    var s = sumFields(rows, ['PO', 'A', 'E']);
    s.G = rows.length;
    s.registered = rows.length > 0;
    var tot = (s.PO || 0) + (s.A || 0) + (s.E || 0);
    // 守備率 = (刺殺+補殺) ÷ (刺殺+補殺+失策)
    s.FPCT = (isNum(s.PO) && isNum(s.A) && isNum(s.E) && tot > 0) ? ((s.PO + s.A) / tot) : null;
    return s;
  }

  /* ---------- 規定打席・規定投球回 ---------- */
  function qualifiers(data, season) {
    var st = data.rankings.settings;
    var g = teamRecord(data, season).G || seasonGames(data, season).length;
    return {
      teamGames: g,
      PA: Math.ceil(g * (Number(st.qualifyPAPerGame) || 0) - 1e-9),
      outs: isNum(st.qualifyIPFixed) ? Math.round(st.qualifyIPFixed * 3) : Math.ceil(g * (Number(st.qualifyIPPerGame) || 0) * 3 - 1e-9),
      ipFixed: isNum(st.qualifyIPFixed)
    };
  }

  /* ---------- MVP ---------- */
  function mvpCounts(data, playerId, season) {
    var ids = seasonGameIdSet(data, season);
    var game = data.games.games.filter(function (g) { return ids[g.id] && g.mvp === playerId; }).length;
    var game2 = data.games.games.filter(function (g) { return ids[g.id] && g.mvp2 === playerId; }).length;
    var sc = scopeOf(season);
    // 月間・年間MVPは試合の種類に関係ない賞なので、大会/練習試合で絞り込み中は数えない
    var aw = sc.kind ? [] : data.rankings.mvpAwards.filter(function (a) { return a.playerId === playerId && (sc.season == null || String(a.season) === sc.season); });
    return {
      game: game,
      game2: game2,
      month: aw.filter(function (a) { return a.type === 'month'; }).length,
      year: aw.filter(function (a) { return a.type === 'year'; }).length
    };
  }

  /* ---------- 順位付けの共通ルール ----------
   * ・同じ値は同じ順位（例: 1位,1位,3位）
   * ・同順位の中の表示順は「背番号の小さい順 → 名前順」に統一
   */
  function numberSortKey(p) {
    var n = parseInt(p.number, 10);
    return isFinite(n) ? n : 9999;
  }
  function assignRanks(items, higherIsBetter) {
    items.sort(function (a, b) {
      var diff = higherIsBetter ? b.value - a.value : a.value - b.value;
      if (Math.abs(diff) > 1e-9) return diff;
      var na = numberSortKey(a.player), nb = numberSortKey(b.player);
      if (na !== nb) return na - nb;
      return String(a.player.name).localeCompare(String(b.player.name), 'ja');
    });
    var rank = 0;
    items.forEach(function (it, i) {
      if (i === 0 || Math.abs(it.value - items[i - 1].value) > 1e-9) rank = i + 1;
      it.rank = rank;
    });
    return items;
  }

  // WP履歴のうち、集計範囲に入るもの。
  // 大会/練習試合で絞り込み中は、その種類の試合から付いたWP（MVP・準MVP・出場）だけを数える（スコアブックと同じ）
  function wpEntries(data, season) {
    var sc = scopeOf(season), ids = sc.kind ? seasonGameIdSet(data, { season: null, kind: sc.kind }) : null;
    return data.rankings.wp.filter(function (e) {
      if (sc.season != null && String(e.season) !== sc.season) return false;
      if (ids) return !!(e.autoGame && ids[e.autoGame]);
      return true;
    });
  }

  // WP: 今季WP・累計WP・前回からの順位変動
  function wpTotals(data, season, excludeLatestDate) {
    var list = wpEntries(data, season);
    var cut = null;
    if (excludeLatestDate && list.length) {
      cut = list.map(function (e) { return e.date || ''; }).sort().pop();
      list = list.filter(function (e) { return (e.date || '') < cut; });
    }
    var tot = {};
    list.forEach(function (e) { tot[e.playerId] = (tot[e.playerId] || 0) + (Number(e.points) || 0); });
    return tot;
  }
  function wpSummary(data, playerId, season) {
    var sc = scopeOf(season);
    var mine = function (e) { return e.playerId === playerId; };
    var hist = wpEntries(data, { season: null, kind: sc.kind }).filter(mine)
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var curIds = {};
    wpEntries(data, season).forEach(function (e) { curIds[e.id] = 1; });
    var cur = 0, total = 0;
    hist.forEach(function (e) {
      total += Number(e.points) || 0;
      if (curIds[e.id]) cur += Number(e.points) || 0;
    });
    return { current: cur, total: total, history: hist };
  }

  /* ---------- ランキング定義（全項目） ----------
   * group: bat=打撃 / pit=投手 / etc=その他
   * main: 3Dのランキング板や選手プロフィールの順位表で使う主要9種目
   * rate: 率の種目（規定打席・規定投球回に届いた選手だけが対象）
   * 回数の種目は多い順（三振・失点なども多い順）、防御率とWHIPだけ少ない順。0の選手は載せない（スコアブックと同じ）
   */
  var ipFmt = function (v) { return outsToIPText(v); };
  var CATEGORIES = [
    { key: 'AVG', label: '打率', unit: '', higher: true, fmt: fmtRate3, rate: 'bat', field: 'AVG', group: 'bat', main: true },
    { key: 'HR', label: '本塁打', unit: '本', higher: true, bat: 'HR', group: 'bat', main: true },
    { key: 'RBI', label: '打点', unit: '', higher: true, bat: 'RBI', group: 'bat', main: true },
    { key: 'H', label: '安打', unit: '本', higher: true, bat: 'H', group: 'bat', main: true },
    { key: 'SB', label: '盗塁', unit: '', higher: true, bat: 'SB', group: 'bat', main: true },
    { key: 'OPS', label: 'OPS', unit: '', higher: true, fmt: fmtRate3, rate: 'bat', field: 'OPS', group: 'bat' },
    { key: 'OBP', label: '出塁率', unit: '', higher: true, fmt: fmtRate3, rate: 'bat', field: 'OBP', group: 'bat' },
    { key: 'SLG', label: '長打率', unit: '', higher: true, fmt: fmtRate3, rate: 'bat', field: 'SLG', group: 'bat' },
    { key: 'R', label: '得点', unit: '', higher: true, bat: 'R', group: 'bat' },
    { key: 'D', label: '二塁打', unit: '本', higher: true, bat: 'D', group: 'bat' },
    { key: 'T', label: '三塁打', unit: '本', higher: true, bat: 'T', group: 'bat' },
    { key: 'TB', label: '塁打', unit: '', higher: true, bat: 'TB', group: 'bat' },
    { key: 'BB', label: '四球', unit: '', higher: true, bat: 'BB', group: 'bat' },
    { key: 'HBP', label: '死球', unit: '', higher: true, bat: 'HBP', group: 'bat' },
    { key: 'BSO', label: '三振', unit: '', higher: true, bat: 'SO', group: 'bat' },
    { key: 'SH', label: '犠打', unit: '', higher: true, bat: 'SH', group: 'bat' },
    { key: 'SF', label: '犠飛', unit: '', higher: true, bat: 'SF', group: 'bat' },
    { key: 'PA', label: '打席', unit: '', higher: true, bat: 'PA', group: 'bat' },
    { key: 'ERA', label: '防御率', unit: '', higher: false, fmt: fmt2, rate: 'pit', field: 'ERA', group: 'pit', main: true },
    { key: 'SO', label: '奪三振', unit: '', higher: true, pit: 'SO', group: 'pit', main: true },
    { key: 'W', label: '勝利', unit: '', higher: true, pit: 'W', group: 'pit' },
    { key: 'SV', label: 'セーブ', unit: '', higher: true, pit: 'SV', group: 'pit' },
    { key: 'WHIP', label: 'WHIP', unit: '', higher: false, fmt: fmt2, rate: 'pit', field: 'WHIP', group: 'pit' },
    { key: 'IP', label: '投球回', unit: '', higher: true, pit: 'outs', fmt: ipFmt, group: 'pit' },
    { key: 'PG', label: '登板', unit: '', higher: true, pit: 'G', group: 'pit' },
    { key: 'L', label: '敗戦', unit: '', higher: true, pit: 'L', group: 'pit' },
    { key: 'HA', label: '被安打', unit: '', higher: true, pit: 'H', group: 'pit' },
    { key: 'BBA', label: '与四球', unit: '', higher: true, pit: 'BB', group: 'pit' },
    { key: 'RA', label: '失点', unit: '', higher: true, pit: 'R', group: 'pit' },
    { key: 'ERN', label: '自責点', unit: '', higher: true, pit: 'ER', group: 'pit' },
    { key: 'MVP', label: 'MVP獲得', unit: '回', higher: true, group: 'etc', main: true },
    { key: 'MVP2', label: '準MVP', unit: '回', higher: true, group: 'etc' },
    { key: 'WP', label: 'WPポイント', unit: 'WP', higher: true, group: 'etc', main: true }
  ];
  function categoryByKey(k) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === k) return CATEGORIES[i];
    return null;
  }

  function ranking(data, season, key) {
    var cat = categoryByKey(key);
    var q = qualifiers(data, season);
    var items = [], unqualified = 0;
    var players = data.players.players;
    var wpNow = key === 'WP' ? wpTotals(data, season, false) : null;
    var wpPrev = null, prevRank = {};
    if (key === 'WP') {
      wpPrev = wpTotals(data, season, true);
      var prevItems = players.filter(function (p) { return p.active !== false; })
        .map(function (p) { return { player: p, value: wpPrev[p.id] || 0 }; });
      assignRanks(prevItems, true).forEach(function (it) { prevRank[it.player.id] = it.rank; });
    }
    players.forEach(function (p) {
      var value = null, display = null, sub = '';
      if (cat.rate === 'bat') {
        var b = aggregateBatting(data, p.id, season);
        if (!b.registered || !isNum(b[cat.field])) return;
        if (!isNum(b.PA) || b.PA < q.PA) { unqualified++; return; }
        value = b[cat.field]; sub = b.AB + '打数' + b.H + '安打' + (cat.field === 'AVG' ? '' : '・' + b.PA + '打席');
      } else if (cat.rate === 'pit') {
        var pt = aggregatePitching(data, p.id, season);
        if (!pt.registered || !isNum(pt[cat.field])) return;
        if (!isNum(pt.outs) || pt.outs < q.outs) { unqualified++; return; }
        value = pt[cat.field]; sub = outsToIPText(pt.outs);
      } else if (cat.bat) {
        var bb = aggregateBatting(data, p.id, season);
        if (!isNum(bb[cat.bat]) || bb[cat.bat] <= 0) return;
        value = bb[cat.bat];
      } else if (cat.pit) {
        var pp = aggregatePitching(data, p.id, season);
        if (!isNum(pp[cat.pit]) || pp[cat.pit] <= 0) return;
        value = pp[cat.pit];
      } else if (key === 'MVP' || key === 'MVP2') {
        var m = mvpCounts(data, p.id, season);
        value = key === 'MVP' ? m.game : m.game2;
        if (value === 0 && (key === 'MVP2' || (m.game2 === 0 && m.month === 0 && m.year === 0))) return;
      } else if (key === 'WP') {
        if (p.active === false && !wpNow[p.id]) return;
        value = wpNow[p.id] || 0;
      }
      display = cat.fmt ? cat.fmt(value) : String(value);
      items.push({ player: p, playerId: p.id, value: value, display: display, sub: sub });
    });
    assignRanks(items, cat.higher);
    if (key === 'WP') {
      var inScope = wpEntries(data, season);
      var hasPrev = inScope.length > 0;
      var dates = {};
      inScope.forEach(function (e) { dates[e.date || ''] = 1; });
      var multipleDates = Object.keys(dates).length > 1;
      items.forEach(function (it) {
        var pr = prevRank[it.playerId];
        it.prevRank = (hasPrev && multipleDates) ? (pr || null) : null;
        it.change = (it.prevRank != null) ? it.prevRank - it.rank : null;
      });
    }
    return { category: cat, items: items, qualifiers: q, unqualified: unqualified };
  }

  // ある選手のチーム内順位一覧
  function playerRanks(data, playerId, season) {
    var out = {};
    CATEGORIES.forEach(function (c) {
      var r = ranking(data, season, c.key);
      var hit = null;
      r.items.forEach(function (it) { if (it.playerId === playerId) hit = it; });
      out[c.key] = hit ? { rank: hit.rank, of: r.items.length, display: hit.display, change: hit.change } : null;
    });
    return out;
  }

  // 個人タイトル（各ランキング単独1位 or 同率1位）
  var TITLE_NAMES = { AVG: '首位打者', HR: '本塁打王', RBI: '打点王', H: '最多安打', SB: '盗塁王', ERA: '最優秀防御率', SO: '最多奪三振', MVP: 'MVP王', WP: 'WP王' };
  function playerTitles(data, playerId, season) {
    var titles = [];
    CATEGORIES.filter(function (c) { return TITLE_NAMES[c.key]; }).forEach(function (c) {
      var r = ranking(data, season, c.key);
      r.items.forEach(function (it) {
        if (TITLE_NAMES[c.key] && it.playerId === playerId && it.rank === 1 && (it.value > 0 || c.key === 'ERA')) titles.push(TITLE_NAMES[c.key]);
      });
    });
    return titles;
  }

  // 称号バッジ（通算の実績から自動付与。データがなければ付与しない）
  function playerBadges(data, playerId) {
    var b = aggregateBatting(data, playerId, null);
    var p = aggregatePitching(data, playerId, null);
    var m = mvpCounts(data, playerId, null);
    var wp = wpSummary(data, playerId, null).total;
    var list = [];
    function add(cond, icon, name) { if (cond) list.push({ icon: icon, name: name }); }
    add(b.G > 0 || p.G > 0, '🧢', 'ルーキーデビュー');
    add(b.G >= 10, '🎖️', '出場10試合');
    add(b.H >= 1, '✨', '初安打');
    add(b.H >= 10, '🔥', '10安打クラブ');
    add(b.HR >= 1, '💥', '初アーチ');
    add(b.HR >= 5, '🚀', 'アーチスト');
    add(b.SB >= 5, '👟', '韋駄天');
    add(p.W >= 1, '🥎', '初勝利');
    add(p.SO >= 10, '🌀', 'Kマシーン');
    add(m.game >= 1, '🏅', '初MVP');
    add(m.game >= 3, '👑', 'MVP常連');
    add(wp >= 100, '💎', 'WP100突破');
    return list;
  }

  /* ---------- 管理画面用の更新操作 ---------- */
  // 試合の登録・更新。同じ日・同じ相手・同じ試合番号の別試合があればエラー（二重登録防止）
  function upsertGame(data, game) {
    var g = clone(game);
    if (!g.date) return { ok: false, error: '試合日を入力してください' };
    if (!normText(g.opponent)) return { ok: false, error: '対戦相手を入力してください' };
    g.gameNo = Number(g.gameNo) || 1;
    if (!g.season) g.season = data.rankings.settings.currentSeason;
    var key = gameKey(g);
    var dup = data.games.games.filter(function (x) { return gameKey(x) === key && x.id !== g.id; })[0];
    if (dup) return { ok: false, error: 'この試合（' + g.date + ' vs ' + g.opponent + ' 第' + g.gameNo + '試合）はすでに登録されています。編集する場合は試合一覧から選んでください。', duplicateId: dup.id };
    if (!g.id) g.id = 'g' + g.date.replace(/-/g, '') + '-' + g.gameNo + '-' + Math.random().toString(36).slice(2, 6);
    var idx = -1;
    data.games.games.forEach(function (x, i) { if (x.id === g.id) idx = i; });
    if (idx >= 0) data.games.games[idx] = g; else data.games.games.push(g);
    if (data.rankings.settings.seasons.indexOf(String(g.season)) < 0) {
      data.rankings.settings.seasons.push(String(g.season));
      data.rankings.settings.seasons.sort();
    }
    return { ok: true, game: g, isNew: idx < 0 };
  }

  // その試合の成績行を「丸ごと置き換え」る。再登録しても二重に足されない
  function setGameStats(data, gameId, rows) {
    ['batting', 'pitching', 'fielding'].forEach(function (type) {
      if (!rows[type]) return;
      data.stats[type] = data.stats[type].filter(function (r) { return r.gameId !== gameId; });
      var seen = {};
      rows[type].forEach(function (r) {
        if (seen[r.playerId]) return; // 同じ選手が2行あっても1行だけ
        seen[r.playerId] = true;
        var row = clone(r); row.gameId = gameId;
        data.stats[type].push(row);
      });
    });
  }

  function deleteGame(data, gameId) {
    data.games.games = data.games.games.filter(function (g) { return g.id !== gameId; });
    ['batting', 'pitching', 'fielding'].forEach(function (t) {
      data.stats[t] = data.stats[t].filter(function (r) { return r.gameId !== gameId; });
    });
  }

  function playerHasRecords(data, playerId) {
    var s = data.stats;
    return s.batting.some(function (r) { return r.playerId === playerId; }) ||
      s.pitching.some(function (r) { return r.playerId === playerId; }) ||
      s.fielding.some(function (r) { return r.playerId === playerId; }) ||
      data.rankings.wp.some(function (r) { return r.playerId === playerId; }) ||
      data.rankings.mvpAwards.some(function (r) { return r.playerId === playerId; }) ||
      data.games.games.some(function (g) { return g.mvp === playerId || g.mvp2 === playerId; });
  }

  function addWP(data, entry) {
    var e = clone(entry);
    e.id = e.id || uid('wp');
    e.points = Number(e.points);
    if (!isFinite(e.points) || e.points === 0) return { ok: false, error: 'ポイントは0以外の数字で入力してください' };
    if (!playerById(data, e.playerId)) return { ok: false, error: '選手が見つかりません' };
    e.season = String(e.season || data.rankings.settings.currentSeason);
    e.date = e.date || new Date().toISOString().slice(0, 10);
    data.rankings.wp.push(e);
    return { ok: true, entry: e };
  }

  // 書き出し用：4つのJSONに分ける
  function splitForExport(data) {
    var stamp = new Date().toISOString();
    return {
      players: Object.assign({ _説明: '選手名簿。admin.html で編集して書き出してください。' }, stripMeta(data.players), { updatedAt: stamp }),
      stats: Object.assign({ _説明: '試合ごとの打撃・投手・守備成績。空欄(未登録)は項目自体がありません。IPはアウト数(outs)で保存。' }, stripMeta(data.stats), { updatedAt: stamp }),
      games: Object.assign({ _説明: '試合結果。同じ日・相手・試合番号の試合は1つだけ登録できます。' }, stripMeta(data.games), { updatedAt: stamp }),
      rankings: Object.assign({ _説明: 'ランキングのルール(規定打席など)・WP履歴・月間/年間MVP・トロフィー。順位そのものは成績から毎回自動計算します。' }, stripMeta(data.rankings), { updatedAt: stamp })
    };
  }
  function stripMeta(o) {
    var c = clone(o);
    Object.keys(c).forEach(function (k) { if (k.charAt(0) === '_' || k === 'updatedAt') delete c[k]; });
    return c;
  }

  /* ---------- データ読み込み（ブラウザ用） ----------
   * 1) 公開サーバー上なら JSON ファイルを読む（常に最新）
   * 2) ダブルクリックで開いた場合（file://）は JSON を読めないため data.js（埋め込み版）を読む
   * 3) どちらも失敗したら、前回この端末で表示できたデータ（キャッシュ）を使う
   */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadData(opts) {
    opts = opts || {};
    var base = opts.base || '';
    var cacheKey = 'wr-cache-' + (opts.cacheName || 'main');
    var names = ['players', 'stats', 'games', 'rankings'];
    function fromJSON() {
      if (location.protocol === 'file:') return Promise.reject(new Error('file'));
      return Promise.all(names.map(function (n) {
        return fetch(base + n + '.json', { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error(n + '.json: ' + r.status);
          return r.json();
        });
      })).then(function (arr) {
        var raw = {}; names.forEach(function (n, i) { raw[n] = arr[i]; });
        return { raw: raw, source: 'json' };
      });
    }
    function fromEmbedded() {
      root.WR_DATA = undefined;
      return loadScript(base + 'data.js?t=' + Date.now()).then(function () {
        if (!root.WR_DATA) throw new Error('data.js が空です');
        return { raw: root.WR_DATA, source: 'embedded' };
      });
    }
    function fromCache() {
      try {
        var c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (c && c.raw) return { raw: c.raw, source: 'cache', cachedAt: c.at };
      } catch (e) { /* noop */ }
      throw new Error('データを読み込めませんでした');
    }
    function save(res) {
      try { localStorage.setItem(cacheKey, JSON.stringify({ raw: res.raw, at: new Date().toISOString() })); } catch (e) { /* noop */ }
      return res;
    }
    return fromJSON().then(save).catch(function () {
      return fromEmbedded().then(save);
    }).catch(function () { return fromCache(); });
  }

  var api = {
    loadData: loadData,
    POSITIONS: POSITIONS, BAT_FIELDS: BAT_FIELDS, PIT_FIELDS: PIT_FIELDS, FLD_FIELDS: FLD_FIELDS,
    CATEGORIES: CATEGORIES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, TITLE_NAMES: TITLE_NAMES,
    isNum: isNum, clone: clone, uid: uid, toNumOrNull: toNumOrNull,
    ipToOuts: ipToOuts, outsToIP: outsToIP, outsToIPText: outsToIPText,
    fmtRate3: fmtRate3, fmt2: fmt2,
    emptyData: emptyData, normalize: normalize,
    playerById: playerById, gameById: gameById, gameKey: gameKey, seasonGames: seasonGames,
    gameResult: gameResult, gameKind: gameKind, GUEST: GUEST, scopeOf: scopeOf, wpEntries: wpEntries,
    KIND_LABEL: { all: "全試合", tour: "大会", prac: "練習試合" }, teamRecord: teamRecord,
    aggregateBatting: aggregateBatting, aggregatePitching: aggregatePitching, aggregateFielding: aggregateFielding,
    qualifiers: qualifiers, mvpCounts: mvpCounts, wpSummary: wpSummary, wpTotals: wpTotals,
    categoryByKey: categoryByKey, ranking: ranking, playerRanks: playerRanks,
    playerTitles: playerTitles, playerBadges: playerBadges,
    upsertGame: upsertGame, setGameStats: setGameStats, deleteGame: deleteGame,
    playerHasRecords: playerHasRecords, addWP: addWP, splitForExport: splitForExport
  };
  root.WRCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
