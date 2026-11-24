// Capturas de la app en estados reales, para revisión visual.
//   node tools/shot.mjs /tmp/app.png preview
//   node tools/shot.mjs /tmp/error.png error
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const out = process.argv[2] ?? "/tmp/sqlstudio.png";
const scenario = process.argv[3] ?? "preview";
const port = 9335;

const steps = {
  preview: `
    document.querySelector('[data-testid="db-node"][data-db="sakila"]').click();
    await waitFor(() => document.querySelectorAll('[data-testid="table-node"]').length > 5);
    document.querySelector('[data-testid="sql-table"][data-table="film"]')?.click();
    if (!document.querySelector('[data-testid="table-node"][data-table="film"]')) throw new Error('sin tabla film');
    document.querySelector('[data-testid="table-node"][data-table="film"] .row-actions [data-testid="sql-table"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => document.querySelectorAll('.data-grid tbody tr').length > 3);
    await sleep(600);
  `,
  query: `
    const view = await waitFor(() => window.__cmView);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert:
      "SELECT f.film_id, f.title, c.name AS categoria, f.rental_rate, f.length\\nFROM sakila.film f\\nJOIN sakila.film_category fc ON fc.film_id = f.film_id\\nJOIN sakila.category c ON c.category_id = fc.category_id\\nORDER BY f.rental_rate DESC, f.length DESC\\nLIMIT 40;" } });
    await sleep(200);
    document.querySelector('[data-testid="run-btn"]').click();
    await waitFor(() => document.querySelectorAll('.data-grid tbody tr').length > 5);
    await sleep(500);
  `,
  inspector: `
    document.querySelector('[data-testid="db-node"][data-db="sakila"]').click();
    await waitFor(() => document.querySelectorAll('[data-testid="table-node"]').length > 5);
    document.querySelector('[data-testid="table-node"][data-table="film"]').click();
    await waitFor(() => document.querySelectorAll('[data-testid="table-row"]').length > 5);
    await sleep(700);
  `,
  map: `
    document.querySelector('[data-testid="map-btn"]').click();
    await waitFor(() => document.querySelector('[data-testid="map-db"]'));
    document.querySelector('[data-testid="map-db"][data-db="sakila"]').click();
    await waitFor(() => document.querySelectorAll('[data-testid="map-node"]').length > 20);
    await sleep(900);
    document.querySelector('[data-testid="map-node"][data-table="rental"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(500);
  `,
  palette: `
    document.querySelector('[data-testid="palette-btn"]').click();
    await waitFor(() => document.querySelector('[data-testid="palette"]'));
    await sleep(1200);
  `,
  error: `
    const view = await waitFor(() => window.__cmView);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert:
      "CALL sakila.alquilar_pelicula(999999, -3);\\nSIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No hay copias disponibles para esta película';" } });
    await sleep(200);
    document.querySelector('[data-testid="run-btn"]').click();
    await waitFor(() => document.querySelector('[data-testid="error-card"]'));
    await sleep(500);
  `,
};

const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1500,950",
    `--remote-debugging-port=${port}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;

try {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === "page");
      if (target) break;
    } catch {
      /* arrancando */
    }
    await sleep(200);
  }
  if (!target) throw new Error("sin conexión con Chromium");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

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

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:8765/?test=1" });
  await sleep(2500);

  const script = steps[scenario] ?? steps.preview;
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitFor = async (fn, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const value = fn();
          if (value) return value;
          await sleep(100);
        }
        throw new Error("tiempo agotado");
      };
      try { ${script} return "ok"; } catch (error) { return "error: " + error.message; }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(`escenario ${scenario}:`, result.result?.result?.value);

  const image = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(out, Buffer.from(image.result.data, "base64"));
  console.log("captura:", out);
} catch (problem) {
  console.error("error:", problem.message ?? problem);
  process.exitCode = 1;
} finally {
  try {
    socket?.close();
  } catch {
    /* ignorado */
  }
  chrome.kill();
}
