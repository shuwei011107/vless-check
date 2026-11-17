// VLESS 节点连通性与出口 IP 测试（临时 Worker）
// 用法：?uuid=<UUID>&host=edgetunnel-suwei.pages.dev&proxyip=ProxyIP.US.CMLiussss.Net&target=ip-api.com
// proxyip 为空表示直连（不走反代）。

function uuidToBytes(s) {
  const h = String(s || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

function concatBytes(list) {
  const n = list.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of list) { out.set(c, o); o += c.length; }
  return out;
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    const uuid = u.searchParams.get("uuid") || "";
    const host = u.searchParams.get("host") || "edgetunnel-suwei.pages.dev";
    const proxyip = u.searchParams.get("proxyip") || "";
    const target = u.searchParams.get("target") || "ip-api.com";
    const uuidBytes = uuidToBytes(uuid);
    if (!uuidBytes) {
      return Response.json({ ok: false, stage: "bad-uuid", hint: "请用 ?uuid=<UUID> 传入" }, { status: 400 });
    }
    const path = proxyip ? "/?proxyip=" + encodeURIComponent(proxyip) : "/";
    const wsUrl = "wss://" + host + path;
    const t0 = Date.now();
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return Response.json({ ok: false, stage: "ws-create", error: String(e) });
    }
    const result = await new Promise((resolve) => {
      const chunks = [];
      let finished = false;
      const done = (obj) => {
        if (finished) return;
        finished = true;
        try { ws.close(); } catch (e) {}
        obj.ms = Date.now() - t0;
        obj.wsUrl = wsUrl;
        obj.proxyip = proxyip || "(直连)";
        obj.path = path;
        resolve(obj);
      };
      const timer = setTimeout(() => done({ ok: false, stage: "timeout", receivedBytes: chunks.reduce((a, c) => a + c.length, 0) }), 20000);
      ws.addEventListener("open", () => {
        try {
          const hostBytes = new TextEncoder().encode(target);
          const httpReq = "GET /json/ HTTP/1.1\r\nHost: " + target + "\r\nUser-Agent: vless-check/1.0\r\nAccept: application/json\r\nConnection: close\r\n\r\n";
          const reqBytes = new TextEncoder().encode(httpReq);
          const buf = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1 + hostBytes.length + reqBytes.length);
          let o = 0;
          buf[o++] = 0;
          buf.set(uuidBytes, o); o += 16;
          buf[o++] = 0;
          buf[o++] = 1;
          buf[o++] = 0; buf[o++] = 80;
          buf[o++] = 2;
          buf[o++] = hostBytes.length;
          buf.set(hostBytes, o); o += hostBytes.length;
          buf.set(reqBytes, o);
          ws.send(buf);
        } catch (e) {
          clearTimeout(timer);
          done({ ok: false, stage: "send-error", error: String(e) });
        }
      });
      ws.addEventListener("message", (ev) => {
        try {
          const d = ev.data;
          chunks.push(d instanceof ArrayBuffer ? new Uint8Array(d) : new TextEncoder().encode(String(d)));
        } catch (e) {}
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        const all = concatBytes(chunks);
        if (all.length <= 2) {
          done({ ok: false, stage: "closed-empty", receivedBytes: all.length, hint: "隧道未返回数据（UUID/反代不可用或目标拒绝）" });
          return;
        }
        const text = new TextDecoder().decode(all.slice(2));
        const idx = text.indexOf("\r\n\r\n");
        const head = idx >= 0 ? text.slice(0, idx) : text;
        const body = idx >= 0 ? text.slice(idx + 4) : "";
        let info = null;
        try { info = JSON.parse(body); } catch (e) {}
        done({
          ok: true,
          stage: "done",
          httpHead: head.split("\r\n")[0] || "",
          ip: info && info.query ? info.query : null,
          country: info && info.country ? info.country : null,
          countryCode: info && info.countryCode ? info.countryCode : null,
          isp: info && info.isp ? info.isp : null,
          body: body.slice(0, 500)
        });
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        done({ ok: false, stage: "ws-error", receivedBytes: chunks.reduce((a, c) => a + c.length, 0) });
      });
    });
    return Response.json(result);
  }
};
