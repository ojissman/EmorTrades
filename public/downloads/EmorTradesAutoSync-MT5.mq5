//+------------------------------------------------------------------+
//|                                          EmorTradesAutoSync-MT5.mq5 |
//|                     EmorTrades — Trading Journal connector EA       |
//|                                                                      |
//| Version 1.0.2 · CONNECT-3 · READ-ONLY by construction               |
//|                                                                      |
//| WHAT THIS IS                                                         |
//|   A read-only synchronization Expert Advisor. It watches YOUR MT5    |
//|   terminal's trading activity (deals, orders, positions, account    |
//|   state) and pushes it to your EmorTrades Trading Journal over       |
//|   HTTPS, where it appears in your journal and analytics.             |
//|                                                                      |
//| WHAT THIS IS NOT                                                     |
//|   It NEVER places, modifies or closes trades. There is no trading    |
//|   code in this file: no OrderSend, no PositionModify, nothing that   |
//|   could touch your positions. It only READS terminal state and       |
//|   reports it. You do not need to enable AutoTrading for it to run.   |
//|                                                                      |
//| SETUP (see EmorTrades → Settings → Connections for the live guide)   |
//|   1. Copy this file to  <Data Folder>\MQL5\Experts\                  |
//|      (MT5: File → Open Data Folder)                                 |
//|   2. Open MetaEditor (F4), open this file, press Compile (F7).       |
//|   3. MT5 → Tools → Options → Expert Advisors:                        |
//|        Allow WebRequest for listed URL → add                          |
//|        https://emortrade.space-z.ai                                  |
//|   4. Drag the EA onto any chart. In the inputs paste your             |
//|      EmorTrades connection token (EmorToken).                        |
//|   5. The chart top-left shows the live sync status. Trades appear     |
//|      in EmorTrades under the linked Trading Account.                 |
//|                                                                      |
//| RECOVERY GUARANTEE                                                   |
//|   Every event is written to a durable local queue BEFORE it is sent, |
//|   and is removed only after the server ACKNOWLEDGES it. MT5 closes,  |
//|   the computer restarts, the internet drops, EmorTrades is down —    |
//|   nothing is lost: on restart the EA re-anchors to the server's      |
//|   checkpoint and re-scans an overlapping history window (server-side |
//|   dedup makes re-sends harmless).                                    |
//+------------------------------------------------------------------+
#property copyright "EmorTrades"
#property version   "1.02"
#property description "EmorTrades read-only trading sync connector (MetaTrader 5)."

//── inputs ────────────────────────────────────────────────────────────────
input string InpToken        = "";                              // EmorTrades connection token
input string InpBaseUrl      = "https://emortrade.space-z.ai";   // EmorTrades server URL
input int    InpFlushSeconds = 5;                               // event flush interval (seconds)
input int    InpHistoryDays  = 30;                              // first-pair history depth in days (0 = full)
input int    InpSnapshotSecs = 60;                              // live-state snapshot interval (seconds)
input bool   InpDebug        = false;                           // verbose journal logging

//── constants ─────────────────────────────────────────────────────────────
#define EA_VERSION          "1.0.2"
#define EA_FOLDER           "EmorTrades"
#define MAX_EVENTS_BATCH    200
#define HTTP_TIMEOUT_MS     15000
#define HEARTBEAT_S         60
#define RECONCILE_S         900      // periodic full reconciliation (15 min)
#define RECOVERY_OVERLAP_S 86400     // 24h lookback overlap (server-agreed)
#define HISTORY_FLOOR_MS    1262304000000 // 2015-01-01 (server-agreed anchor)

//── runtime state ─────────────────────────────────────────────────────────
string   g_token          = "";
string   g_connId         = "";
bool     g_paired         = false;
bool     g_stopped        = false;     // server requested disconnect
long     g_checkpointMs   = 0;         // server-acked newest event time
long     g_seq            = 0;         // monotonic local sequence
long     g_lastSyncReqSeen = 0;
datetime g_lastHeartbeat  = 0;
datetime g_lastSnapshot   = 0;
datetime g_lastReconcile  = 0;
datetime g_backoffUntil  = 0;
int      g_failStreak     = 0;
string   g_lastStatus     = "starting";
string   g_sentSpecs      = "|";
int      g_beatCount      = 0;

//+------------------------------------------------------------------+
//| JSON helpers (hand-rolled, allocation-light)                      |
//+------------------------------------------------------------------+
string JEscape(const string s)
  {
   string out = "";
   int    len = StringLen(s);
   for(int i = 0; i < len; i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '\\' || c == '"')      out += "\\" + ShortToString(c);
      else if(c == '\n')             out += "\\n";
      else if(c == '\r')             out += "\\r";
      else if(c == '\t')             out += "\\t";
      else if(c < 32)                 out += " ";
      else                           out += ShortToString(c);
     }
   return out;
  }
string JStr(const string s) { return "\"" + JEscape(s) + "\""; }
string JNum(const double v) { return DoubleToString(v, 8); }
string JInt(const long v)   { return IntegerToString(v); }

/** Extract a flat "key":"value" (string) or "key":<scalar> field. */
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

/** Parse an ISO-8601 UTC timestamp ("2026-11-19T12:34:56.789Z") → epoch ms. */
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
   int dot = StringFind(iso, ".");
   if(dot > 0 && dot + 4 <= StringLen(iso))
      ms += (long)(StringToDouble(StringSubstr(iso, dot, 4)) * 1000.0);
   return ms;
  }

/** Extract a flat string array "key":["a","b"] into out[]. */
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
//| Durable queue (write-ahead local file, one JSON line per event)   |
//+------------------------------------------------------------------+
string QueuePath() { return EA_FOLDER + "\\queue-" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + ".jsonl"; }
string StatePath() { return EA_FOLDER + "\\state-" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + ".txt"; }

/** Append one event line to the durable queue (crash-safe write-ahead). */
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

/** Read up to maxLines pending event lines (oldest first). */
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

/** Rewrite the queue with the first dropCount lines removed. */
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

/** Persist the restart anchors (pairing + checkpoint + sequence). */
void SaveState()
  {
   FolderCreate(EA_FOLDER);
   int h = FileOpen(StatePath(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, "connId=" + g_connId + "\n");
   FileWriteString(h, "checkpointMs=" + IntegerToString(g_checkpointMs) + "\n");
   FileWriteString(h, "seq=" + IntegerToString(g_seq) + "\n");
   FileWriteString(h, "lastSyncReq=" + IntegerToString(g_lastSyncReqSeen) + "\n");
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
//| HTTP (WebRequest — the ONLY network surface, POST + JSON)          |
//|                                                                    |
//| CONNECT-3 (v1.0.2): the owner's 2026 MetaEditor build no longer    |
//| offers the classic 8-parameter overload (the one with data_size) — |
//| its compiler lists exactly TWO WebRequest forms:                   |
//|   WebRequest(method, url, cookie, referer, timeout, data[],        |
//|             data_size, result[], result_headers)   (9 params)      |
//|   WebRequest(method, url, headers, timeout, data[],                |
//|             result[], result_headers)              (7 params)     |
//| This file uses the 7-parameter form: custom headers survive       |
//| (Content-Type + token header), and the byte count is guaranteed   |
//| by ArrayResize — the whole array IS exactly the UTF-8 payload,    |
//| so the removed data_size argument carries no information.          |
//| History: v1.0.0 called a 7-param form with a STRING body (never   |
//| compiled); v1.0.1 used the 8-param form the new builds removed.   |
//| The token also rides the JSON body of every call (pair/events/    |
//| heartbeat), so auth does not depend on custom headers surviving   |
//| brokers/proxies.                                                  |
//+------------------------------------------------------------------+
int HttpPost(const string path, const string body, string &response)
  {
   string headers = "Content-Type: application/json\r\n"
                    "x-connector-token: " + g_token + "\r\n";
   uchar  dataArr[];                            // request body bytes (UTF-8)
   uchar  resultArr[];                           // response body bytes
   string resultHeaders = "";
   int     bytes = StringToCharArray(body, dataArr, 0, -1, CP_UTF8);
   if(bytes > 0 && dataArr[bytes - 1] == 0) bytes--;    // strip the trailing NUL
   ArrayResize(dataArr, bytes);          // exactly the payload — the 7-param
                                         // overload sends the WHOLE array
   ResetLastError();
   int    status = WebRequest("POST", InpBaseUrl + path, headers, HTTP_TIMEOUT_MS,
                              dataArr, resultArr, resultHeaders);
   if(status == -1)
      Print("EmorTradesAutoSync: WebRequest failed (", GetLastError(),
            ") — check Tools→Options→Expert Advisors→Allow WebRequest for ", InpBaseUrl);
   response = (ArraySize(resultArr) > 0) ? CharArrayToString(resultArr, 0, WHOLE_ARRAY, CP_UTF8) : "";
   return status;
  }

//+------------------------------------------------------------------+
//| Payload builders (terminal facts → the universal event schema)   |
//+------------------------------------------------------------------+
string DealJson(const ulong ticket)
  {
   long   ptk    = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
   long   timeMs = HistoryDealGetInteger(ticket, DEAL_TIME_MSC);
   if(timeMs <= 0) timeMs = HistoryDealGetInteger(ticket, DEAL_TIME) * 1000;
   int    entry  = (int)HistoryDealGetInteger(ticket, DEAL_ENTRY);
   int    dtype  = (int)HistoryDealGetInteger(ticket, DEAL_TYPE);
   double vol    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   string sym    = HistoryDealGetString(ticket, DEAL_SYMBOL);
   if(ptk <= 0 || vol <= 0.0 || StringLen(sym) == 0) return "";   // balance op — not a trade
   return StringFormat("{\"ticket\":%s,\"positionTicket\":%s,\"time\":%s,\"entry\":%s,\"side\":%s,"
                       "\"volume\":%s,\"price\":%s,\"commission\":%s,\"swap\":%s,\"profit\":%s,"
                       "\"symbol\":%s,\"comment\":%s}",
                       JInt((long)ticket), JInt(ptk), JNum((double)timeMs / 1000.0),
                       JInt(entry), (dtype == 0 ? "\"buy\"" : "\"sell\""),
                       JNum(vol), JNum(HistoryDealGetDouble(ticket, DEAL_PRICE)),
                       JNum(HistoryDealGetDouble(ticket, DEAL_COMMISSION)),
                       JNum(HistoryDealGetDouble(ticket, DEAL_SWAP)),
                       JNum(HistoryDealGetDouble(ticket, DEAL_PROFIT)),
                       JStr(sym), JStr(HistoryDealGetString(ticket, DEAL_COMMENT)));
  }

string OrderStateJson(const ulong ticket, const string stateOverride)
  {
   string kind, side;
   switch((int)OrderGetInteger(ORDER_TYPE))
     {
      case 0: kind = "market";          side = "buy";  break;
      case 1: kind = "market";          side = "sell"; break;
      case 2: kind = "buy_limit";       side = "buy";  break;
      case 3: kind = "sell_limit";      side = "sell"; break;
      case 4: kind = "buy_stop";        side = "buy";  break;
      case 5: kind = "sell_stop";       side = "sell"; break;
      case 6: kind = "buy_stop_limit";  side = "buy";  break;
      case 7: kind = "sell_stop_limit"; side = "sell"; break;
      default: return "";
     }
   string state = stateOverride;
   if(state == "")
      switch((int)OrderGetInteger(ORDER_STATE))
        {
         case 0: case 1: state = "pending";  break;
         case 2:         state = "partial";  break;
         case 3:         state = "filled";   break;
         case 4: case 5: state = "canceled"; break;
         case 6: case 7: state = "expired";  break;
         case 8:         state = "rejected"; break;
         default:        state = "pending";
        }
   long placedMs = OrderGetInteger(ORDER_TIME_SETUP_MSC);
   if(placedMs <= 0) placedMs = OrderGetInteger(ORDER_TIME_SETUP) * 1000;
   long doneMs = OrderGetInteger(ORDER_TIME_DONE) * 1000;
   string doneField = (doneMs > 0) ? StringFormat(",\"timeDone\":%s", JNum((double)doneMs / 1000.0)) : "";
   return StringFormat("{\"orderId\":%s,\"kind\":%s,\"state\":%s,\"symbol\":%s,\"side\":%s,"
                       "\"requestedVolume\":%s,\"filledVolume\":%s,\"price\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timePlaced\":%s%s,\"comment\":%s}",
                       JInt((long)ticket), JStr(kind), JStr(state), JStr(OrderGetString(ORDER_SYMBOL)),
                       JStr(side), JNum(OrderGetDouble(ORDER_VOLUME_CURRENT)),
                       JNum(OrderGetDouble(ORDER_VOLUME_CURRENT)),
                       JNum(OrderGetDouble(ORDER_PRICE_OPEN)),
                       JNum(OrderGetDouble(ORDER_SL)), JNum(OrderGetDouble(ORDER_TP)),
                       JNum((double)placedMs / 1000.0), doneField,
                       JStr(OrderGetString(ORDER_COMMENT)));
  }

string HistoryOrderJson(const ulong ticket)
  {
   string kind, side;
   switch((int)HistoryOrderGetInteger(ticket, ORDER_TYPE))
     {
      case 0: kind = "market";          side = "buy";  break;
      case 1: kind = "market";          side = "sell"; break;
      case 2: kind = "buy_limit";       side = "buy";  break;
      case 3: kind = "sell_limit";      side = "sell"; break;
      case 4: kind = "buy_stop";        side = "buy";  break;
      case 5: kind = "sell_stop";       side = "sell"; break;
      case 6: kind = "buy_stop_limit";  side = "buy";  break;
      case 7: kind = "sell_stop_limit"; side = "sell"; break;
      default: return "";
     }
   string state;
   switch((int)HistoryOrderGetInteger(ticket, ORDER_STATE))
     {
      case 0: case 1: state = "pending";  break;
      case 2:         state = "partial";  break;
      case 3:         state = "filled";   break;
      case 4: case 5: state = "canceled"; break;
      case 6: case 7: state = "expired";  break;
      case 8:         state = "rejected"; break;
      default:        state = "pending";
     }
   long placedMs = HistoryOrderGetInteger(ticket, ORDER_TIME_SETUP_MSC);
   if(placedMs <= 0) placedMs = HistoryOrderGetInteger(ticket, ORDER_TIME_SETUP) * 1000;
   long doneMs = HistoryOrderGetInteger(ticket, ORDER_TIME_DONE) * 1000;
   string doneField = (doneMs > 0) ? StringFormat(",\"timeDone\":%s", JNum((double)doneMs / 1000.0)) : "";
   return StringFormat("{\"orderId\":%s,\"kind\":%s,\"state\":%s,\"symbol\":%s,\"side\":%s,"
                       "\"requestedVolume\":%s,\"filledVolume\":%s,\"price\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timePlaced\":%s%s,\"comment\":%s}",
                       JInt((long)ticket), JStr(kind), JStr(state),
                       JStr(HistoryOrderGetString(ticket, ORDER_SYMBOL)), JStr(side),
                       JNum(HistoryOrderGetDouble(ticket, ORDER_VOLUME_CURRENT)),
                       JNum(HistoryOrderGetDouble(ticket, ORDER_VOLUME_CURRENT)),
                       JNum(HistoryOrderGetDouble(ticket, ORDER_PRICE_OPEN)),
                       JNum(HistoryOrderGetDouble(ticket, ORDER_SL)),
                       JNum(HistoryOrderGetDouble(ticket, ORDER_TP)),
                       JNum((double)placedMs / 1000.0), doneField,
                       JStr(HistoryOrderGetString(ticket, ORDER_COMMENT)));
  }

string PositionJson(const ulong ticket)
  {
   if(!PositionSelectByTicket(ticket)) return "";
   string side = ((int)PositionGetInteger(POSITION_TYPE) == 0) ? "long" : "short";
   long  openMs = PositionGetInteger(POSITION_TIME) * 1000;
   return StringFormat("{\"positionId\":%s,\"symbol\":%s,\"side\":%s,\"volumeCurrent\":%s,"
                       "\"volumeInitial\":%s,\"priceOpen\":%s,\"sl\":%s,\"tp\":%s,"
                       "\"timeOpen\":%s,\"state\":\"open\",\"profit\":%s,\"comment\":%s}",
                       JInt((long)ticket), JStr(PositionGetString(POSITION_SYMBOL)), JStr(side),
                       JNum(PositionGetDouble(POSITION_VOLUME)),
                       JNum(PositionGetDouble(POSITION_VOLUME)),
                       JNum(PositionGetDouble(POSITION_PRICE_OPEN)),
                       JNum(PositionGetDouble(POSITION_SL)), JNum(PositionGetDouble(POSITION_TP)),
                       JNum((double)openMs / 1000.0), JNum(PositionGetDouble(POSITION_PROFIT)),
                       JStr(PositionGetString(POSITION_COMMENT)));
  }

string AccountJson(const bool withLogin)
  {
   string login = withLogin ? StringFormat("\"login\":%s,", JInt(AccountInfoInteger(ACCOUNT_LOGIN))) : "";
   return StringFormat("{%s\"currency\":%s,\"leverage\":%s,\"balance\":%s,\"equity\":%s,"
                       "\"margin\":%s,\"freeMargin\":%s,\"marginLevel\":%s,\"floatingPnl\":%s}",
                       login, JStr(AccountInfoString(ACCOUNT_CURRENCY)),
                       JInt(AccountInfoInteger(ACCOUNT_LEVERAGE)),
                       JNum(AccountInfoDouble(ACCOUNT_BALANCE)), JNum(AccountInfoDouble(ACCOUNT_EQUITY)),
                       JNum(AccountInfoDouble(ACCOUNT_MARGIN)), JNum(AccountInfoDouble(ACCOUNT_MARGIN_FREE)),
                       JNum(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL)), JNum(AccountInfoDouble(ACCOUNT_PROFIT)));
  }

string SymbolSpecJson(const string sym)
  {
   if(StringLen(sym) == 0) return "";
   if(StringFind(g_sentSpecs, "|" + sym + "|") >= 0) return "";
   g_sentSpecs += sym + "|";
   return StringFormat("{\"symbol\":%s,\"digits\":%s,\"contractSize\":%s,\"tickSize\":%s,"
                       "\"tickValue\":%s,\"volumeMin\":%s,\"volumeMax\":%s,\"volumeStep\":%s,"
                       "\"calcMode\":%s,\"currencyBase\":%s,\"currencyProfit\":%s}",
                       JStr(sym),
                       JInt(SymbolInfoInteger(sym, SYMBOL_DIGITS)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX)),
                       JNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP)),
                       JInt(SymbolInfoInteger(sym, SYMBOL_TRADE_CALC_MODE)),
                       JStr(SymbolInfoString(sym, SYMBOL_CURRENCY_BASE)),
                       JStr(SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT)));
  }

//+------------------------------------------------------------------+
//| PAIR — bind the token to this terminal account                    |
//+------------------------------------------------------------------+
bool DoPair()
  {
   string body = StringFormat("{\"token\":%s,\"platform\":\"mt5\","
                              "\"terminal\":{\"version\":%s,\"build\":%s,\"company\":%s},"
                              "\"account\":{\"login\":%s,\"server\":%s,\"company\":%s,\"name\":%s,"
                              "\"currency\":%s,\"leverage\":%s,\"balance\":%s,\"equity\":%s}}",
                              JStr(g_token),
                              JStr(EA_VERSION + "/b" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD))),
                              JStr(IntegerToString(TerminalInfoInteger(TERMINAL_BUILD))),
                              JStr(AccountInfoString(ACCOUNT_COMPANY)),
                              JInt(AccountInfoInteger(ACCOUNT_LOGIN)),
                              JStr(AccountInfoString(ACCOUNT_SERVER)),
                              JStr(AccountInfoString(ACCOUNT_COMPANY)),
                              JStr(AccountInfoString(ACCOUNT_NAME)),
                              JStr(AccountInfoString(ACCOUNT_CURRENCY)),
                              JInt(AccountInfoInteger(ACCOUNT_LEVERAGE)),
                              JNum(AccountInfoDouble(ACCOUNT_BALANCE)),
                              JNum(AccountInfoDouble(ACCOUNT_EQUITY)));
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
      if(InpDebug) Print("EmorTradesAutoSync: paired (connection ", g_connId, ")");
      return true;
     }
   if(st == 401) g_lastStatus = "auth_error";
   if(st == 409) g_stopped = true;
   Print("EmorTradesAutoSync: pair failed (HTTP ", st, ")");
   return false;
  }

//+------------------------------------------------------------------+
//| Flush the durable queue (batch → server → drop only ACKed lines) |
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
      // acks arrive in order; drop the first ackCount lines when they match
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
   if(InpDebug) Print("EmorTradesAutoSync: flushed ", ackCount, "/", n, " acks · queued now ", QueueDepth());
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
//| HEARTBEAT + server desired-state (the only server→EA channel)    |
//+------------------------------------------------------------------+
void DoHeartbeat()
  {
   // an account snapshot rides along every 10th beat (~10 min) or on demand
   g_beatCount++;
   string body = StringFormat("{\"token\":%s,\"status\":\"%s\",\"queueDepth\":%s,\"eaVersion\":%s}",
                              JStr(g_token), g_lastStatus, JInt(QueueDepth()), JStr(EA_VERSION));
   if(g_beatCount % 10 == 0)
      body = StringFormat("{\"token\":%s,\"status\":\"%s\",\"queueDepth\":%s,\"eaVersion\":%s,\"account\":%s}",
                          JStr(g_token), g_lastStatus, JInt(QueueDepth()), JStr(EA_VERSION), AccountJson(true));
   string resp = "";
   int    st = HttpPost("/api/connector/v1/heartbeat", body, resp);
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
   else if(st == 401)
      g_lastStatus = "auth_error";
  }

//+------------------------------------------------------------------+
//| RECOVERY — overlapping history lookback + live state re-report    |
//+------------------------------------------------------------------+
void DoRecovery(const string reason)
  {
   long nowMs = (long)TimeCurrent() * 1000;
   long fromMs;
   if(g_checkpointMs > 0)
      fromMs = g_checkpointMs - RECOVERY_OVERLAP_S * 1000;    // overlap: never trust one timestamp
   else
     {
      int days = (InpHistoryDays > 0) ? InpHistoryDays : 4300; // 0 = full history
      fromMs = nowMs - (long)days * 86400000;
     }
   if(fromMs < HISTORY_FLOOR_MS) fromMs = HISTORY_FLOOR_MS;

   if(InpDebug) Print("EmorTradesAutoSync: recovery (", reason, ") from ", TimeToString((datetime)(fromMs / 1000)));

   g_lastStatus = "recovering";
   if(HistorySelect((datetime)(fromMs / 1000), (datetime)(nowMs / 1000 + 60)))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong tk = HistoryDealGetTicket(i);
         if(tk == 0) continue;
         string json = DealJson(tk);
         if(json == "") continue;
         long ms = HistoryDealGetInteger(tk, DEAL_TIME_MSC);
         if(ms <= 0) ms = HistoryDealGetInteger(tk, DEAL_TIME) * 1000;
         Enqueue("d" + IntegerToString((long)tk), "deal", ms, json);
         string spec = SymbolSpecJson(HistoryDealGetString(tk, DEAL_SYMBOL));
         if(spec != "") Enqueue("ss_" + HistoryDealGetString(tk, DEAL_SYMBOL), "symbol_spec", ms, spec);
        }
      int ototal = HistoryOrdersTotal();
      for(int i = 0; i < ototal; i++)
        {
         ulong tk = HistoryOrderGetTicket(i);
         if(tk == 0) continue;
         string json = HistoryOrderJson(tk);
         if(json == "") continue;
         long ms = HistoryOrderGetInteger(tk, ORDER_TIME_SETUP_MSC);
         if(ms <= 0) ms = HistoryOrderGetInteger(tk, ORDER_TIME_SETUP) * 1000;
         Enqueue("o" + IntegerToString((long)tk), "order", ms, json);
        }
     }
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      string json = PositionJson(tk);
      if(json == "") continue;
      Enqueue("p" + IntegerToString((long)tk), "position", PositionGetInteger(POSITION_TIME) * 1000, json);
     }
   for(int i = 0; i < OrdersTotal(); i++)
     {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      if((int)OrderGetInteger(ORDER_TYPE) <= 1) continue;     // market rows — not pending
      string json = OrderStateJson(tk, "");
      if(json == "") continue;
      long ms = OrderGetInteger(ORDER_TIME_SETUP_MSC);
      if(ms <= 0) ms = (long)TimeCurrent() * 1000;
      Enqueue("o" + IntegerToString((long)tk), "order", ms, json);
     }
   while(QueueDepth() > 0 && !g_stopped)
      if(!FlushQueue("history")) break;
   g_lastStatus = "syncing";
  }

//+------------------------------------------------------------------+
//| EVENT-DRIVEN capture — OnTradeTransaction                        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(!g_paired || g_stopped) return;
   switch(trans.type)
     {
      case TRADE_TRANSACTION_DEAL_ADD:
        {
         if(trans.deal == 0) return;
         if(!HistoryDealSelect(trans.deal)) return;
         string json = DealJson(trans.deal);
         if(json == "") return;
         long ms = HistoryDealGetInteger(trans.deal, DEAL_TIME_MSC);
         if(ms <= 0) ms = HistoryDealGetInteger(trans.deal, DEAL_TIME) * 1000;
         Enqueue("d" + IntegerToString((long)trans.deal), "deal", ms, json);
         string spec = SymbolSpecJson(trans.symbol);
         if(spec != "") Enqueue("ss_" + trans.symbol, "symbol_spec", ms, spec);
         break;
        }
      case TRADE_TRANSACTION_ORDER_ADD:
      case TRADE_TRANSACTION_ORDER_UPDATE:
      case TRADE_TRANSACTION_ORDER_DELETE:
        {
         if(trans.order == 0) return;
         string json = "";
         if(OrderSelect(trans.order))
            json = OrderStateJson(trans.order, "");
         else if(HistoryOrderSelect(trans.order))
            json = HistoryOrderJson(trans.order);
         if(json == "") return;
         Enqueue("o" + IntegerToString((long)trans.order), "order", (long)TimeCurrent() * 1000, json);
         break;
        }
      case TRADE_TRANSACTION_POSITION:
        {
         if(trans.position == 0) return;
         string json = PositionJson(trans.position);
         if(json == "") return;
         Enqueue("p" + IntegerToString((long)trans.position), "position",
                 PositionGetInteger(POSITION_TIME) * 1000, json);
         break;
        }
      case TRADE_TRANSACTION_REQUEST:
        {
         // rejected user requests are observable here (state:'rejected')
         if(trans.order > 0 && result.retcode != 0 &&
            result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_PLACED)
           {
            if(OrderSelect(trans.order))
              {
               string json = OrderStateJson(trans.order, "rejected");
               if(json != "")
                  Enqueue("o" + IntegerToString((long)trans.order), "order", (long)TimeCurrent() * 1000, json);
              }
           }
         break;
        }
      default: break;
     }
  }

//+------------------------------------------------------------------+
//| Timer: pair → flush → snapshot → heartbeat → periodic reconcile  |
//+------------------------------------------------------------------+
void OnTimer()
  {
   Comment(StatusText());
   if(g_token == "") return;                                  // waiting for the token input
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

   // periodic live-state snapshot (positions/orders reconciliation)
   if(TimeCurrent() - g_lastSnapshot >= InpSnapshotSecs)
     {
      g_lastSnapshot = TimeCurrent();
      for(int i = 0; i < PositionsTotal(); i++)
        {
         ulong tk = PositionGetTicket(i);
         if(tk == 0) continue;
         string json = PositionJson(tk);
         if(json != "")
            Enqueue("p" + IntegerToString((long)tk), "position", PositionGetInteger(POSITION_TIME) * 1000, json);
        }
      for(int i = 0; i < OrdersTotal(); i++)
        {
         ulong tk = OrderGetTicket(i);
         if(tk == 0) continue;
         if((int)OrderGetInteger(ORDER_TYPE) <= 1) continue;
         string json = OrderStateJson(tk, "");
         if(json != "")
           {
            long ms = OrderGetInteger(ORDER_TIME_SETUP_MSC);
            if(ms <= 0) ms = (long)TimeCurrent() * 1000;
            Enqueue("o" + IntegerToString((long)tk), "order", ms, json);
           }
        }
      Enqueue("as" + IntegerToString(g_seq), "account", (long)TimeCurrent() * 1000, AccountJson(true));
      FlushQueue("live");
     }

   if(TimeCurrent() - g_lastHeartbeat >= HEARTBEAT_S)
     {
      g_lastHeartbeat = TimeCurrent();
      DoHeartbeat();
     }

   // periodic full reconciliation (the anti-corruption guarantee)
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
   if(s > 600) s = 600;
   return s;
  }

string StatusText()
  {
   if(g_token == "")
      return "EmorTrades AutoSync — waiting: enter your EmorTrades connection token in the EA inputs.\n"
             "Read-only connector: it never trades.";
   return StringFormat("EmorTrades AutoSync %s · %s\nstatus: %s · queued: %d · checkpoint: %s\ndesired: %s",
                       EA_VERSION, "read-only", g_lastStatus, QueueDepth(),
                       (g_checkpointMs > 0 ? TimeToString((datetime)(g_checkpointMs / 1000), TIME_DATE | TIME_SECONDS) : "none"),
                       (g_stopped ? "disconnect (server)" : "sync"));
  }

//+------------------------------------------------------------------+
//| Init / Deinit                                                     |
//+------------------------------------------------------------------+
int OnInit()
  {
   g_token = InpToken;
   if(StringLen(g_token) > 0 && StringFind(g_token, "emorta_") != 0)
      Print("EmorTradesAutoSync: the token does not look like an EmorTrades connection token (expected emorta_...) — paste it exactly as shown in Settings → Connections");
   LoadState();
   g_sentSpecs = "|";
   EventSetTimer(MathMax(1, InpFlushSeconds));
   Print("EmorTradesAutoSync v", EA_VERSION, " attached — read-only sync to ", InpBaseUrl);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   // nothing is lost on removal: the durable queue + server checkpoint are
   // the restart anchors (best-effort final flush when healthy)
   if(g_paired && !g_stopped && reason != REASON_CHARTCHANGE && reason != REASON_RECOMPILE)
      FlushQueue("live");
   Comment("");
  }
//+------------------------------------------------------------------+
