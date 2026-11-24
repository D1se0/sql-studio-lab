// Ejecuta el arnés de interfaz (/tests/ui.html) con un Chromium real y espera
// a que termine, sin depender de --virtual-time-budget (que adelanta el reloj y
// hace expirar las esperas antes de que React pinte).
//
//   node tools/ui-run.mjs [url] [captura.png]
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const url = process.argv[2] ?? "http://127.0.0.1:8765/tests/ui.html";
const shot = process.argv[3] ?? "";
const port = 9334;

const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1460,1010",
    `--remote-debugging-port=${port}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let socket;
let exitCode = 1;

try {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === "page");
      if (target) break;
    } catch {
      /* todavía arrancando */
    }
    await sleep(200);
  }
  if (!target) throw new Error("no se pudo conectar con Chromium");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let counter = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++counter;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const message = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return message.result?.result?.value;
  };

  await send("Page.enable");
  await send("Page.navigate", { url });

  const deadline = Date.now() + 240_000;
  let summary = "";
  while (Date.now() < deadline) {
    summary = (await evaluate("document.getElementById('summary')?.textContent || ''")) ?? "";
    if (/^RESULTADO \d+ correctas/.test(summary)) break;
    await sleep(400);
  }

  const body = (await evaluate("document.body.innerText")) ?? "";
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(PASS|FAIL) ·|^RESULTADO/.test(line));
  console.log(lines.join("\n"));
  console.log(`RESUMEN: ${summary || "sin resumen (¿arnés atascado?)"}`);

  const failed = Number((summary.match(/(\d+) fallidas/) ?? [])[1] ?? "99");
  exitCode = failed === 0 ? 0 : 1;

  if (shot) {
    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(shot, Buffer.from(image.result.data, "base64"));
    console.log(`captura: ${shot}`);
  }
} catch (problem) {
  console.error("error en el ejecutor:", problem.message ?? problem);
  exitCode = 1;
} finally {
  try {
    socket?.close();
  } catch {
    /* ignorado */
  }
  chrome.kill();
}

process.exit(exitCode);
