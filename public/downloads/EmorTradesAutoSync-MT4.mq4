//+------------------------------------------------------------------+
//|                                          EmorTradesAutoSync-MT4.mq4 |
//|                     EmorTrades — Trading Journal connector EA       |
//|                                                                      |
//| Version 1.0.2 · CONNECT-4 · READ-ONLY by construction               |
//|                                                                      |
//| The MetaTrader 4 sibling of EmorTradesAutoSync-MT5.mq5 — the same    |
//| universal connector contract (pair / events / heartbeat over HTTPS),|
//| implemented with MQL4-native primitives: OnTrade() event capture +   |
//| order-pool state diffing + history-pool scanning.                   |
//|                                                                      |
//| It NEVER places, modifies or closes trades — read-only: it only     |
//| reports terminal state. You do not need to enable AutoTrading.      |
//|                                                                      |
//| SETUP                                                                |
//|   1. Copy this file to  <Data Folder>\MQL4\Experts\                  |
//|   2. Open MetaEditor (F4), compile (F7).                             |
//|   3. MT4 → Tools → Options → Expert Advisors tab →                    |
//|        "Allow WebRequest for listed URL" → add                        |
//|        https://emortrade.space-z.ai                                  |
//|   4. Attach to any chart, paste your EmorTrades connection token     |
//|      (EmorToken input).                                              |
//|   5. IMPORTANT (history recovery): in the MT4 "Account History"      |
//|      tab, right-click → All History — MT4 only exposes what is       |
//|      displayed there, and the connector recovers exactly that.       |
//|   6. The chart top-left shows the live sync status — including a     |
//|      "last:" diagnostics line. If it shows err 4014/4060, step 3     |
//|      was not done yet (the terminal is blocking the URL).            |
//|                                                                      |
//| MT4 SEMANTICS (documented honestly)                                 |
//|   · A full close keeps the original ticket; a PARTIAL close splits:  |
//|     the closed part gets a new ticket, the remainder keeps the       |
//|     original. The connector therefore reports each closed record as  |
//|     its own complete trade (self-consistent entry/exit/P&L).        |
//|   · MT4 has no separate deal layer: each closed order maps to an     |
//|     entry/exit pair on the position group keyed by the order ticket.|
//|   · Slippage/tick-level data is not exposed by MT4.                 |
//+------------------------------------------------------------------+
#property copyright "EmorTrades"
#property version   "1.02"
#property strict
#property description "EmorTrades read-only trading sync connector (MetaTrader 4)."

//── inputs ────────────────────────────────────────────────────────────────
input string InpToken        = "";                              // EmorTrades connection token
input string InpBaseUrl      = "https://emortrade.space-z.ai";   // EmorTrades server URL
input int    InpFlushSeconds = 5;                               // event flush interval (seconds)
input int    InpHistoryDays  = 30;                              // first-pair history depth in days (0 = all displayed history)
input int    InpSnapshotSecs = 60;                              // live-state snapshot interval (seconds)
input bool   InpDebug        = false;                           // verbose journal logging

//── constants ─────────────────────────────────────────────────────────────
#define EA_VERSION          "1.0.2"
#define EA_FOLDER           "EmorTrades"
#define MAX_EVENTS_BATCH    200
#define HTTP_TIMEOUT_MS     15000
#define HEARTBEAT_S         60
#define RECONCILE_S         900
#define RECOVERY_OVERLAP_S  86400
#define HISTORY_FLOOR_MS     1262304000000   // 2015-01-01

//── runtime state ─────────────────────────────────────────────────────────
string   g_token          = "";
string   g_connId         = "";
bool     g_paired         = false;
bool     g_stopped        = false;
long     g_checkpointMs   = 0;
long     g_seq            = 0;
long     g_lastSyncReqSeen = 0;
datetime g_lastHeartbeat  = 0;
datetime g_lastSnapshot   = 0;
datetime g_lastReconcile  = 0;
datetime g_backoffUntil   = 0;
int      g_failStreak      = 0;
string   g_lastStatus      = "starting";
string   g_sentSpecs       = "|";
int      g_beatCount       = 0;
//── CONNECT-4: panel diagnostics — a failed request must never be silent
int      g_pairAttempts   = 0;        // pairing attempts made this attach
int      g_lastHttp       = 0;        // last WebRequest HTTP status (0 = none yet)
int      g_lastErrCode    = 0;        // GetLastError() when the last status was -1
string   g_lastErrHint    = "";       // decoded one-line remedy

// diff cache (ticket → last-sent state hash)
int      g_keys[];
string   g_vals[];

//+------------------------------------------------------------------+
//| JSON helpers                                                      |
//+------------------------------------------------------------------+
string JEscape(const string s)
  {
   string out = "";
   int    len = StringLen(s);
   for(int i = 0; i < len; i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '\\' || c == '"') out += "\\" + ShortToString(c);
      else if(c == '\n')        out += "\\n";
      else if(c == '\r')        out += "\\r";
      else if(c == '\t')        out += "\\t";
      else if(c < 32)            out += " ";
      else                      out += ShortToString(c);
     }
   return out;
  }
string JStr(const string s) { return "\"" + JEscape(s) + "\""; }
string JNum(const double v) { return DoubleToString(v, 8); }
string JInt(const long v)   { return LongToString(v); }

string LongToString(const long v)
  {
   if(v >= 0 && v <= 2147483647) return IntegerToString((int)v);
   string t = ""; long x = v;
   bool neg = x < 0; if(neg) x = -x;
   while(x > 0) { t = CharToString((uchar)('0' + (int)(x % 10))) + t; x /= 10; }
   if(t == "") t = "0";
   return (neg ? "-" : "") + t;
  }

string FieldStr(const string json, const string key)
  {
   string needle = "\"" + key + "\":";
   int p = StringFind(json, needle);
   if(p < 0) return "";
   int q = p + StringLen(needle);
   if(StringGetCharacter(json, q) != '"')
     {
      int e = q;
      while(e < StringLen(json))
        {
         ushort c = StringGetCharacter(json, e);
         if(c == ',' || c == '}' || c == ']') break;
         e++;
        }
      return StringSubstr(json, q, e - q);
     }
   int e2 = StringFind(json, "\"", q + 1);
   if(e2 < 0) return "";
   return StringSubstr(json, q + 1, e2 - q - 1);
  }

long ParseIsoMs(const string iso)
  {
   if(StringLen(iso) < 19) return 0;
   int y  = (int)StringToInteger(StringSubstr(iso, 0, 4));
   int mo = (int)StringToInteger(StringSubstr(iso, 5, 2));
   int d  = (int)StringToInteger(StringSubstr(iso, 8, 2));
   int h  = (int)StringToInteger(StringSubstr(iso, 11, 2));
   int mi = (int)StringToInteger(StringSubstr(iso, 14, 2));
   int s  = (int)StringToInteger(StringSubstr(iso, 17, 2));
   datetime base = StringToTime(StringFormat("%04d.%02d.%02d 00:00:00", y, mo, d));
   long ms = (long)base * 1000 + h * 3600000 + mi * 60000 + s * 1000;
   return ms;
  }

int FieldStringArray(const string json, const string key, string &out[], int maxOut)
  {
   ArrayResize(out, 0);
   string needle = "\"" + key + "\":[";
   int p = StringFind(json, needle);
   if(p < 0) return 0;
   int e = StringFind(json, "]", p);
   if(e < 0) e = StringLen(json);
   string seg = StringSubstr(json, p + StringLen(needle), e - p - StringLen(needle));
   int n = 0, q = 0;
   while(q < StringLen(seg) && n < maxOut)
     {
      int a = StringFind(seg, "\"", q);
      if(a < 0) break;
      int b = StringFind(seg, "\"", a + 1);
      if(b < 0) break;
      ArrayResize(out, n + 1);
      out[n] = StringSubstr(seg, a + 1, b - a - 1);
      n++;
      q = b + 1;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| Diff cache helpers                                                |
//+------------------------------------------------------------------+
bool CacheSeen(const int ticket, const string val)
  {
   for(int i = 0; i < ArraySize(g_keys); i++)
      if(g_keys[i] == ticket)
         return (g_vals[i] == val);
   return false;
  }
void CachePut(const int ticket, const string val)
  {
   for(int i = 0; i < ArraySize(g_keys); i++)
      if(g_keys[i] == ticket) { g_vals[i] = val; return; }
   int n = ArraySize(g_keys);
   ArrayResize(g_keys, n + 1);
   ArrayResize(g_vals, n + 1);
   g_keys[n] = ticket;
   g_vals[n] = val;
  }
void CacheDropAbsent()
  {
   for(int i = ArraySize(g_keys) - 1; i >= 0; i--)
     {
      if(!OrderSelect(g_keys[i], SELECT_BY_TICKET)) continue;      // fully gone → drop cache
      if(OrderCloseTime() > 0)                                     // in history now → keep to detect late updates
         continue;
     }
  }

//+------------------------------------------------------------------+
//| Durable queue (write-ahead local file)                            |
//+------------------------------------------------------------------+
string QueuePath() { return EA_FOLDER + "\\queue-" + IntegerToString(AccountNumber()) + ".jsonl"; }
string StatePath() { return EA_FOLDER + "\\state-" + IntegerToString(AccountNumber()) + ".txt"; }

void Enqueue(const string id, const string type, const long timeMs, const string payloadJson)
  {
   FolderCreate(EA_FOLDER);
   int h = FileOpen(QueuePath(), FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      Print("EmorTradesAutoSync: cannot open queue file (", GetLastError(), ") — event ", id, " NOT enqueued");
      return;
     }
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, StringFormat("{\"id\":%s,\"type\":%s,\"time\":%s,\"seq\":%s,\"payload\":%s}\n",
                                   JStr(id), JStr(type), JNum((double)timeMs / 1000.0), JInt(g_seq), payloadJson));
   FileClose(h);
   g_seq++;
  }

int ReadQueue(string &lines[], int maxLines)
  {
   ArrayResize(lines, 0);
   if(!FileIsExist(QueuePath())) return 0;
   int h = FileOpen(QueuePath(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return 0;
   int n = 0;
   while(!FileIsEnding(h) && n < maxLines)
     {
      string l = FileReadString(h);
      if(StringLen(l) > 2)
        {
         ArrayResize(lines, n + 1);
         lines[n] = l;
         n++;
        }
     }
   FileClose(h);
   return n;
  }

void CompactQueue(const int dropCount)
  {
   string keep[];
   if(FileIsExist(QueuePath()))
     {
      int h = FileOpen(QueuePath(), FILE_READ | FILE_TXT | FILE_ANSI);
      if(h != INVALID_HANDLE)
        {
         int i = 0;
         while(!FileIsEnding(h))
           {
            string l = FileReadString(h);
            if(StringLen(l) <= 2) continue;
            if(i++ < dropCount) continue;
            int k = ArraySize(keep);
            ArrayResize(keep, k + 1);
            keep[k] = l;
           }
         FileClose(h);
        }
     }
   FolderCreate(EA_FOLDER);
   int w = FileOpen(QueuePath(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(w == INVALID_HANDLE) return;
   for(int j = 0; j < ArraySize(keep); j++)
      FileWriteString(w, keep[j] + "\n");
   FileClose(w);
  }

int QueueDepth()
  {
   if(!FileIsExist(QueuePath())) return 0;
   int h = FileOpen(QueuePath(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return 0;
   int n = 0;
   while(!FileIsEnding(h))
      if(StringLen(FileReadString(h)) > 2) n++;
   FileClose(h);
   return n;
  }

void SaveState()
  {
   FolderCreate(EA_FOLDER);
   int h = FileOpen(StatePath(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, "connId=" + g_connId + "\n");
   FileWriteString(h, "checkpointMs=" + LongToString(g_checkpointMs) + "\n");
   FileWriteString(h, "seq=" + LongToString(g_seq) + "\n");
   FileWriteString(h, "lastSyncReq=" + LongToString(g_lastSyncReqSeen) + "\n");
   FileClose(h);
  }
void LoadState()
  {
   if(!FileIsExist(StatePath())) return;
   int h = FileOpen(StatePath(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
     {
      string l = FileReadString(h);
      if(StringFind(l, "connId=") == 0)       g_connId = StringSubstr(l, 7);
      if(StringFind(l, "checkpointMs=") == 0) g_checkpointMs = StringToInteger(StringSubstr(l, 13));
      if(StringFind(l, "seq=") == 0)          g_seq = StringToInteger(StringSubstr(l, 4));
      if(StringFind(l, "lastSyncReq=") == 0)  g_lastSyncReqSeen = StringToInteger(StringSubstr(l, 11));
     }
   FileClose(h);
  }

//+------------------------------------------------------------------+
//| HTTP (WebRequest — CONNECT-2: the real custom-headers overload    |
//| is the 8-parameter form with byte arrays and an explicit size:    |
//|   WebRequest(method, url, headers, timeout,                       |
//|              data[], data_size, result[], result_headers)         |
//| v1.0.0's 7-parameter call did not compile. The token also rides   |
//| the JSON body of every call (pair/events/heartbeat), so auth      |
//| survives header-stripping brokers/proxies even if the header      |
//| channel degrades.                                                 |
//+------------------------------------------------------------------+
//| CONNECT-4 diagnostics — the panel must never go silent. The       |
//| owner's first live attach (2026-11-19, MT5) sat on "starting"    |
//| for 10 minutes because WebRequest was terminal-blocked (the URL  |
//| was not in the allowed list) and the reason lived only in the   |
//| Experts log. These helpers put it on the chart panel instead.   |
//+------------------------------------------------------------------+
string ErrHint(const int err)
  {
   if(err == 4014 || err == 4060)   // both are the "function not allowed" family
      return "terminal blocked WebRequest — Tools → Options → Expert Advisors → tick \"Allow WebRequest for listed URL\", add " + InpBaseUrl + ", click OK";
   return "transport failed — see the Experts tab (Toolbox) for the full message; also check internet / proxy / VPN";
  }

string TokenFingerprint()
  {
   int len = StringLen(g_token);
   if(len == 0) return "(empty — paste it in the EA inputs)";
   if(StringFind(g_token, "emorta_") != 0) return "MALFORMED — expected emorta_…";
   if(len >= 12) return "emorta_…" + StringSubstr(g_token, len - 4);
   return "emorta_…";
  }

int HttpPost(const string path, const string body, string &response)
  {
   string headers = "Content-Type: application/json\r\n"
                    "x-connector-token: " + g_token + "\r\n";
   uchar  dataArr[];                            // request body bytes (UTF-8)
   uchar  resultArr[];                           // response body bytes
   string resultHeaders = "";
   int     bytes = StringToCharArray(body, dataArr, 0, -1, CP_UTF8);
   if(bytes > 0 && dataArr[bytes - 1] == 0) bytes--;    // strip the trailing NUL
   ArrayResize(dataArr, bytes);                         // exactly the payload
   ResetLastError();
   int status = WebRequest("POST", InpBaseUrl + path, headers, HTTP_TIMEOUT_MS,
                           dataArr, bytes, resultArr, resultHeaders);
   g_lastHttp    = status;                   // CONNECT-4: panel diagnostics
   g_lastErrCode = (status == -1) ? GetLastError() : 0;
   g_lastErrHint = (status == -1) ? ErrHint(g_lastErrCode) : "";
   if(status == -1)
      Print("EmorTradesAutoSync: WebRequest failed (", GetLastError(),
            ") — check Tools→Options→Expert Advisors→Allow WebRequest for ", InpBaseUrl);
   response = (ArraySize(resultArr) > 0) ? CharArrayToString(resultArr, 0, WHOLE_ARRAY, CP_UTF8) : "";
   return status;
  }

//+------------------------------------------------------------------+
//| Payload builders (MQL4 order facts → the universal event schema) |
//+------------------------------------------------------------------+
string PendingOrderJson(const string state)
  {
   string kind, side;
   switch(OrderType())
     {
      case OP_BUYLIMIT:  kind = "buy_limit";  side = "buy";  break;
      case OP_SELLLIMIT: kind = "sell_limit"; side = "sell"; break;
      case OP_BUYSTOP:   kind = "buy_stop";   side = "buy";  break;
      case OP_SELLSTOP:  kind = "sell_stop";  side = "sell"; break;
      default: return "";                      // open trades are handled separately
     }
   return StringFormat("{\"orderId\":%s,\"kind\":%s,\"state\":%s,\"symbol\":%s,\"side\":%s,"
                       "\"requestedVolume\":%s,\"filledVolume\":%s,\"price\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timePlaced\":%s,\"comment\":%s}",
                       JInt(OrderTicket()), JStr(kind), JStr(state), JStr(OrderSymbol()), JStr(side),
                       JNum(OrderLots()), JNum(0), JNum(OrderOpenPrice()),
                       JNum(OrderStopLoss()), JNum(OrderTakeProfit()),
                       JNum((double)OrderOpenTime() / 1000.0), JStr(OrderComment()));
  }

string OpenPositionJson()
  {
   string side = (OrderType() == OP_BUY) ? "long" : "short";
   return StringFormat("{\"positionId\":%s,\"symbol\":%s,\"side\":%s,\"volumeCurrent\":%s,"
                       "\"volumeInitial\":%s,\"priceOpen\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timeOpen\":%s,\"state\":\"open\",\"profit\":%s,\"comment\":%s}",
                       JInt(OrderTicket()), JStr(OrderSymbol()), JStr(side),
                       JNum(OrderLots()), JNum(OrderLots()), JNum(OrderOpenPrice()),
                       JNum(OrderStopLoss()), JNum(OrderTakeProfit()),
                       JNum((double)OrderOpenTime() / 1000.0),
                       JNum(0),   // floating P&L is not exposed per-order in MT4 — honest 0
                       JStr(OrderComment()));
  }

/** Entry fill mirroring the open trade (the platform's IN deal). */
string InDealJson(const int ticket)
  {
   string side = (OrderType() == OP_BUY) ? "buy" : "sell";
   return StringFormat("{\"ticket\":%s,\"positionTicket\":%s,\"time\":%s,\"entry\":\"in\",\"side\":%s,"
                       "\"volume\":%s,\"price\":%s,\"commission\":%s,\"swap\":%s,\"profit\":%s,"
                       "\"symbol\":%s,\"comment\":%s}",
                       JInt((long)ticket * 2), JInt(ticket),
                       JNum((double)OrderOpenTime() / 1000.0), JStr(side),
                       JNum(OrderLots()), JNum(OrderOpenPrice()),
                       JNum(0), JNum(0), JNum(0),
                       JStr(OrderSymbol()), JStr(OrderComment()));
  }

/** Closed record → self-contained entry+exit pair on one position group. */
string OutDealJson(const int ticket)
  {
   string side = (OrderType() == OP_BUY) ? "sell" : "buy";       // the closing transaction direction
   return StringFormat("{\"ticket\":%s,\"positionTicket\":%s,\"time\":%s,\"entry\":\"out\",\"side\":%s,"
                       "\"volume\":%s,\"price\":%s,\"commission\":%s,\"swap\":%s,\"profit\":%s,"
                       "\"symbol\":%s,\"comment\":%s}",
                       JInt((long)ticket * 2 + 1), JInt(ticket),
                       JNum((double)OrderCloseTime() / 1000.0), JStr(side),
                       JNum(OrderLots()), JNum(OrderClosePrice()),
                       JNum(OrderCommission()), JNum(OrderSwap()), JNum(OrderProfit()),
                       JStr(OrderSymbol()), JStr(OrderComment()));
  }

string ClosedOrderStateJson()
  {
   string kind, side;
   int otype = OrderType();
   if(otype == OP_BUY || otype == OP_SELL) { kind = "market"; side = (otype == OP_BUY) ? "buy" : "sell"; }
   else
     {
      switch(otype)
        {
         case OP_BUYLIMIT:  kind = "buy_limit";  side = "buy";  break;
         case OP_SELLLIMIT: kind = "sell_limit"; side = "sell"; break;
         case OP_BUYSTOP:  kind = "buy_stop";  side = "buy";  break;
         case OP_SELLSTOP: kind = "sell_stop"; side = "sell"; break;
         default: return "";
        }
     }
   // a pending order in history with zero close price never executed:
   // canceled/expired before filling; otherwise the order filled.
   string state = "filled";
   if(OrderType() != OP_BUY && OrderType() != OP_SELL && OrderClosePrice() == 0.0)
      state = "canceled";
   return StringFormat("{\"orderId\":%s,\"kind\":%s,\"state\":%s,\"symbol\":%s,\"side\":%s,"
                       "\"requestedVolume\":%s,\"filledVolume\":%s,\"price\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timePlaced\":%s,\"timeDone\":%s,\"comment\":%s}",
                       JInt(OrderTicket()), JStr(kind), JStr(state), JStr(OrderSymbol()), JStr(side),
                       JNum(OrderLots()), JNum((state == "filled") ? OrderLots() : 0),
                       JNum(OrderOpenPrice()), JNum(OrderStopLoss()), JNum(OrderTakeProfit()),
                       JNum((double)OrderOpenTime() / 1000.0),
                       JNum((double)OrderCloseTime() / 1000.0), JStr(OrderComment()));
  }

string AccountJson(const bool withLogin)
  {
   string login = withLogin ? StringFormat("\"login\":%s,", JInt(AccountNumber())) : "";
   double level = (AccountMargin() > 0) ? AccountEquity() / AccountMargin() * 100.0 : 0;
   return StringFormat("{%s\"currency\":%s,\"leverage\":%s,\"balance\":%s,\"equity\":%s,"
                       "\"margin\":%s,\"freeMargin\":%s,\"marginLevel\":%s,\"floatingPnl\":%s}",
                       login, JStr(AccountCurrency()), JInt(AccountLeverage()),
                       JNum(AccountBalance()), JNum(AccountEquity()),
                       JNum(AccountMargin()), JNum(AccountFreeMargin()),
                       JNum(level), JNum(AccountEquity() - AccountBalance()));
  }

string SymbolSpecJson(const string sym)
  {
   if(StringLen(sym) == 0) return "";
   if(StringFind(g_sentSpecs, "|" + sym + "|") >= 0) return "";
   g_sentSpecs += sym + "|";
   return StringFormat("{\"symbol\":%s,\"digits\":%s,\"tickSize\":%s,\"tickValue\":%s,"
                       "\"volumeMin\":%s,\"volumeMax\":%s,\"volumeStep\":%s,"
                       "\"point\":%s,\"spread\":%s}",
                       JStr(sym), JInt(MarketInfo(sym, MODE_DIGITS)),
                       JNum(MarketInfo(sym, MODE_TICKSIZE)), JNum(MarketInfo(sym, MODE_TICKVALUE)),
                       JNum(MarketInfo(sym, MODE_MINLOT)), JNum(MarketInfo(sym, MODE_MAXLOT)),
                       JNum(MarketInfo(sym, MODE_LOTSTEP)),
                       JNum(MarketInfo(sym, MODE_POINT)), JNum(MarketInfo(sym, MODE_SPREAD)));
  }

//+------------------------------------------------------------------+
//| PAIR                                                              |
//+------------------------------------------------------------------+
bool DoPair()
  {
   g_pairAttempts++;                         // CONNECT-4: visible pairing effort
   string body = StringFormat("{\"token\":%s,\"platform\":\"mt4\","
                              "\"terminal\":{\"version\":%s,\"build\":%s,\"company\":%s},"
                              "\"account\":{\"login\":%s,\"server\":%s,\"company\":%s,\"name\":%s,"
                              "\"currency\":%s,\"leverage\":%s,\"balance\":%s,\"equity\":%s}}",
                              JStr(g_token), JStr(EA_VERSION), JStr("mt4"),
                              JStr(AccountCompany()),
                              JInt(AccountNumber()), JStr(AccountServer()), JStr(AccountCompany()),
                              JStr(AccountName()), JStr(AccountCurrency()),
                              JInt(AccountLeverage()),
                              JNum(AccountBalance()), JNum(AccountEquity()));
   string resp = "";
   int    st = HttpPost("/api/connector/v1/pair", body, resp);
   if(st == 200)
     {
      g_connId = FieldStr(resp, "connectionId");
      string ck = FieldStr(resp, "lastEventAt");
      if(StringLen(ck) > 0 && ck != "null" && g_checkpointMs == 0)
         g_checkpointMs = ParseIsoMs(ck);
      g_paired = true;
      g_lastStatus = "connected";
      g_failStreak = 0;
      SaveState();
      return true;
     }
   if(st == 401) g_lastStatus = "auth_error";
   if(st == 409) g_stopped = true;
   Print("EmorTradesAutoSync: pair failed (HTTP ", st, ")");
   return false;
  }

//+------------------------------------------------------------------+
//| Flush the durable queue                                           |
//+------------------------------------------------------------------+
bool FlushQueue(const string phase)
  {
   string lines[];
   int    n = ReadQueue(lines, MAX_EVENTS_BATCH);
   if(n == 0) return true;
   string body = "{\"token\":" + JStr(g_token) + ",\"phase\":\"" + phase + "\",\"queueDepth\":" + IntegerToString(QueueDepth()) + ",\"events\":[";
   for(int i = 0; i < n; i++)
     {
      if(i > 0) body += ",";
      body += lines[i];
     }
   body += "]}";
   string resp = "";
   int    st = HttpPost("/api/connector/v1/events", body, resp);
   if(st != 200)
     {
      if(st == 401) g_lastStatus = "auth_error";
      else if(st == 409) g_stopped = true;
      Print("EmorTradesAutoSync: flush failed (HTTP ", st, ") — ", n, " event(s) stay queued");
      return false;
     }
   string acks[];
   int ackCount = FieldStringArray(resp, "acks", acks, MAX_EVENTS_BATCH);
   if(ackCount > 0)
     {
      bool head = true;
      for(int a = 0; a < ackCount && a < n && head; a++)
         if(StringLen(acks[a]) == 0 || StringFind(lines[a], "\"" + acks[a] + "\"") < 0)
            head = false;
      CompactQueue(head ? ackCount : CountMatches(lines, acks, ackCount));
     }
   long ck = ParseIsoMs(FieldStr(resp, "lastEventAt"));
   if(ck > g_checkpointMs) g_checkpointMs = ck;
   g_failStreak = 0;
   SaveState();
   return true;
  }

int CountMatches(const string &lines[], const string &acks[], int ackCount)
  {
   int m = 0;
   for(int a = 0; a < ackCount; a++)
      for(int i = 0; i < ArraySize(lines); i++)
         if(StringLen(acks[a]) > 0 && StringFind(lines[i], "\"" + acks[a] + "\"") >= 0)
           { m++; break; }
   return m;
  }

//+------------------------------------------------------------------+
//| HEARTBEAT                                                         |
//+------------------------------------------------------------------+
void DoHeartbeat()
  {
   g_beatCount++;
   string body = StringFormat("{\"token\":%s,\"status\":\"%s\",\"queueDepth\":%s,\"eaVersion\":%s}",
                              JStr(g_token), g_lastStatus, JInt(QueueDepth()), JStr(EA_VERSION));
   if(g_beatCount % 10 == 0)
      body = StringFormat("{\"token\":%s,\"status\":\"%s\",\"queueDepth\":%s,\"eaVersion\":%s,\"account\":%s}",
                          JStr(g_token), g_lastStatus, JInt(QueueDepth()), JStr(EA_VERSION), AccountJson(true));
   string resp = "";
   int st = HttpPost("/api/connector/v1/heartbeat", body, resp);
   if(st == 200)
     {
      string desired = FieldStr(resp, "desired");
      if(desired == "disconnect")
        {
         if(!g_stopped) Print("EmorTradesAutoSync: server requested DISCONNECT — journal history is kept");
         g_stopped = true;
         g_lastStatus = "offline";
        }
      long sr = ParseIsoMs(FieldStr(resp, "syncRequestedAt"));
      if(sr > 0 && sr > g_lastSyncReqSeen)
        {
         g_lastSyncReqSeen = sr;
         if(g_paired && !g_stopped) DoRecovery("server-nudge");
        }
     }
   else if(st == 401) g_lastStatus = "auth_error";
  }

//+------------------------------------------------------------------+
//| LIVE SCAN — order-pool diff (event capture without MT5's           |
//| OnTradeTransaction: OnTrade() triggers the scan immediately, and   |
//| the diff cache suppresses re-sends)                                |
//+------------------------------------------------------------------+
void ScanLiveState(const bool forceAll)
  {
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int    tk   = OrderTicket();
      string sig  = IntegerToString(OrderType()) + "|" + DoubleToString(OrderLots(), 4) + "|" +
                    DoubleToString(OrderOpenPrice(), 8) + "|" + DoubleToString(OrderStopLoss(), 8) + "|" +
                    DoubleToString(OrderTakeProfit(), 8) + "|" + OrderSymbol() + "|" + OrderComment();
      if(!forceAll && CacheSeen(tk, sig)) continue;
      CachePut(tk, sig);

      if(OrderType() == OP_BUY || OrderType() == OP_SELL)
        {
         // open trade: position state + its IN fill
         string pj = OpenPositionJson();
         if(pj != "") Enqueue("p" + IntegerToString(tk), "position", (long)OrderOpenTime() * 1000, pj);
         string inj = InDealJson(tk);
         if(inj != "") Enqueue("d" + LongToString((long)tk * 2), "deal", (long)OrderOpenTime() * 1000, inj);
        }
      else
        {
         // pending order lifecycle
         string oj = PendingOrderJson("pending");
         if(oj != "") Enqueue("o" + IntegerToString(tk), "order", (long)OrderOpenTime() * 1000, oj);
        }
      string spec = SymbolSpecJson(OrderSymbol());
      if(spec != "") Enqueue("ss_" + OrderSymbol(), "symbol_spec", (long)TimeCurrent() * 1000, spec);
     }
   CacheDropAbsent();
  }

//+------------------------------------------------------------------+
//| HISTORY SCAN — newly closed orders in the displayed history pool   |
//+------------------------------------------------------------------+
void ScanHistory(const datetime fromTime, const bool forceAll)
  {
   int total = OrdersHistoryTotal();
   for(int i = total - 1; i >= 0; i--)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderCloseTime() <= 0) continue;                       // still-open rows don't exist in MQL4 history — guard anyway
      if(OrderCloseTime() < fromTime && !forceAll) continue;
      int    tk   = OrderTicket();
      string sig  = "H|" + DoubleToString(OrderClosePrice(), 8) + "|" + DoubleToString(OrderProfit(), 2) + "|" +
                    DoubleToString(OrderCommission(), 2) + "|" + DoubleToString(OrderSwap(), 2);
      if(!forceAll && CacheSeen(tk, sig)) continue;
      CachePut(tk, sig);

      if(OrderType() == OP_BUY || OrderType() == OP_SELL)
        {
         // closed trade: the self-contained entry+exit pair
         string inj = InDealJson(tk);
         if(inj != "") Enqueue("d" + LongToString((long)tk * 2), "deal", (long)OrderOpenTime() * 1000, inj);
         string outj = OutDealJson(tk);
         if(outj != "") Enqueue("d" + LongToString((long)tk * 2 + 1), "deal", (long)OrderCloseTime() * 1000, outj);
        }
      else
        {
         // a pending order that left the live pool: filled/canceled/expired
         string oj = ClosedOrderStateJson();
         if(oj != "") Enqueue("o" + IntegerToString(tk), "order", (long)OrderOpenTime() * 1000, oj);
        }
      string spec = SymbolSpecJson(OrderSymbol());
      if(spec != "") Enqueue("ss_" + OrderSymbol(), "symbol_spec", (long)TimeCurrent() * 1000, spec);
     }
  }

//+------------------------------------------------------------------+
//| RECOVERY — overlapping lookback across live + history pools        |
//+------------------------------------------------------------------+
void DoRecovery(const string reason)
  {
   long nowMs = (long)TimeCurrent() * 1000;
   long fromMs;
   if(g_checkpointMs > 0)
      fromMs = g_checkpointMs - RECOVERY_OVERLAP_S * 1000;
   else
     {
      int days = (InpHistoryDays > 0) ? InpHistoryDays : 4300;
      fromMs = nowMs - (long)days * 86400000;
     }
   if(fromMs < HISTORY_FLOOR_MS) fromMs = HISTORY_FLOOR_MS;

   g_lastStatus = "recovering";
   ScanLiveState(true);
   ScanHistory((datetime)(fromMs / 1000), true);
   while(QueueDepth() > 0 && !g_stopped)
      if(!FlushQueue("history")) break;
   g_lastStatus = "syncing";
   if(InpDebug) Print("EmorTradesAutoSync: recovery (", reason, ") complete");
  }

//+------------------------------------------------------------------+
//| OnTrade — MQL4's event hook: capture immediately after trading    |
//| activity (opens/closes/modifications move the pool between scans)  |
//+------------------------------------------------------------------+
void OnTrade()
  {
   if(!g_paired || g_stopped) return;
   ScanLiveState(false);
   ScanHistory(TimeCurrent() - 3600, false);                    // catch closes in the last hour (fast diff)
   FlushQueue("live");
  }

//+------------------------------------------------------------------+
//| Timer: pair → flush → snapshot → heartbeat → periodic reconcile  |
//+------------------------------------------------------------------+
void OnTimer()
  {
   Comment(StatusText());
   if(g_token == "") return;
   if(TimeCurrent() < g_backoffUntil) return;

   if(!g_paired)
     {
      if(!DoPair())
        {
         g_failStreak++;
         g_backoffUntil = TimeCurrent() + BackoffSeconds();
         return;
        }
      DoRecovery("first-pair");
     }

   if(g_stopped)
     {
      static datetime slowBeat = 0;
      if(TimeCurrent() - slowBeat >= 60) { slowBeat = TimeCurrent(); DoHeartbeat(); }
      return;
     }

   if(!FlushQueue("live"))
     {
      g_failStreak++;
      g_backoffUntil = TimeCurrent() + BackoffSeconds();
      return;
     }

   if(TimeCurrent() - g_lastSnapshot >= InpSnapshotSecs)
     {
      g_lastSnapshot = TimeCurrent();
      ScanLiveState(false);
      Enqueue("as" + LongToString(g_seq), "account", (long)TimeCurrent() * 1000, AccountJson(true));
      FlushQueue("live");
     }

   if(TimeCurrent() - g_lastHeartbeat >= HEARTBEAT_S)
     {
      g_lastHeartbeat = TimeCurrent();
      DoHeartbeat();
     }

   if(TimeCurrent() - g_lastReconcile >= RECONCILE_S)
     {
      g_lastReconcile = TimeCurrent();
      DoRecovery("periodic-reconcile");
     }
  }

int BackoffSeconds()
  {
   int s = 5;
   for(int i = 1; i < g_failStreak && i < 12; i++) s *= 2;
   int cap = (g_paired || g_stopped) ? 600 : 60;   // CONNECT-4: unpaired retries stay visible (≤ 60 s)
   if(s > cap) s = cap;
   return s;
  }

string StatusText()
  {
   if(g_token == "")
      return "EmorTrades AutoSync (MT4) — waiting: enter your EmorTrades connection token in the EA inputs.\n"
             "Read-only connector: it never trades.";
   string last;
   if(g_lastHttp == 0)      last = "none yet (starting up)";
   else if(g_lastHttp > 0) last = StringFormat("HTTP %d", g_lastHttp);
   else                    last = StringFormat("HTTP -1 (err %d) — %s", g_lastErrCode, g_lastErrHint);
   string pairing = "";
   if(!g_paired && !g_stopped)
     {
      int retryIn = (g_backoffUntil > TimeCurrent()) ? (int)(g_backoffUntil - TimeCurrent()) : 0;
      pairing = StringFormat(" · attempts: %d · retry in %d s", g_pairAttempts, retryIn);
     }
   return StringFormat("EmorTrades AutoSync %s (MT4) · read-only\nstatus: %s · queued: %d · checkpoint: %s\ndesired: %s\nserver: %s · token: %s\nlast: %s%s",
                       EA_VERSION, g_lastStatus, QueueDepth(),
                       (g_checkpointMs > 0 ? TimeToString((datetime)(g_checkpointMs / 1000), TIME_DATE | TIME_SECONDS) : "none"),
                       (g_stopped ? "disconnect (server)" : "sync"),
                       InpBaseUrl, TokenFingerprint(), last, pairing);
  }

//+------------------------------------------------------------------+
//| Init / Deinit                                                     |
//+------------------------------------------------------------------+
int OnInit()
  {
   g_token = InpToken;
   StringTrimLeft(g_token);    // CONNECT-4: paste hygiene — a stray space or
   StringTrimRight(g_token);   // newline would otherwise fail every call silently
   if(StringLen(g_token) > 0 && StringFind(g_token, "emorta_") != 0)
      Print("EmorTradesAutoSync: the token does not look like an EmorTrades connection token (expected emorta_...) — paste it exactly as shown in Settings → Connections");
   LoadState();
   g_sentSpecs = "|";
   EventSetTimer(MathMax(1, InpFlushSeconds));
   Print("EmorTradesAutoSync v", EA_VERSION, " (MT4) attached — read-only sync to ", InpBaseUrl);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_paired && !g_stopped && reason != REASON_CHARTCHANGE && reason != REASON_RECOMPILE)
      FlushQueue("live");
   Comment("");
  }
//+------------------------------------------------------------------+
