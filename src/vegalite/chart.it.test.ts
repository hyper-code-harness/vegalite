// vegalite.chart against the real duckdb plugin (a devDependency), through Hyper's harness:
// bun <hyper-code>/script/plugin-test.ts .
import { expect, test } from "bun:test";
import { testCtx } from "hyper:test";

const ctx: any = await testCtx();

test("charts a DuckDB query result", async () => {
    const chart = await ctx.fns.vegalite.chart({
        sql: "SELECT 'alpha' AS label, 3 AS n UNION ALL SELECT 'beta', 5",
        x: "label",
        y: "n",
        title: "Demo",
    });
    expect(chart.svg).toStartWith("<svg");
    expect(chart.spec.mark).toBe("bar");
    expect(chart.spec.encoding.x.type).toBe("nominal");
    expect(chart.spec.encoding.y.type).toBe("quantitative");
    expect(chart.rows.length).toBe(2);
});

test("picks a temporal axis for dates", async () => {
    const chart = await ctx.fns.vegalite.chart({ sql: "SELECT DATE '2026-01-02' AS day, 1 AS n UNION ALL SELECT DATE '2026-01-03', 4", mark: "line" });
    expect(chart.spec.encoding.x.type).toBe("temporal");
});

test("names the columns it actually got when one is missing", async () => {
    await expect(ctx.fns.vegalite.chart({ sql: "SELECT 'a' AS label, 'b' AS other" })).rejects.toThrow(/no numeric column.*label, other/);
});

test("a duckdb chart= fence draws through vegalite.chart", async () => {
    await ctx.fns.settings.set({ module: "duckdb", scopeType: "global", key: "allowFence", value: true });
    const html = await ctx.fns.markdown.render({ source: "```duckdb chart=bar x=label y=n\nSELECT 'a' AS label, 2 AS n\n```" });
    expect(html).toContain("<svg");
});
