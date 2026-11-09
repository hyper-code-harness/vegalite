// Rows in, picture out. What is missing between data and vegalite.render is the
// boring part: naming the columns, picking a type for each channel and writing
// the spec by hand. This function guesses those from the rows' own types and
// lets any of it be overridden. Rows come inline or from SQL through the duckdb
// plugin, which is optional: vegalite does not need it for anything else.

/**
 * Charts rows, or the result of a DuckDB query, without writing a Vega-Lite spec.
 *
 * The fastest path from data to a picture: give rows (or SQL, when the duckdb
 * plugin is mounted) and the columns for the axes, get back an inline SVG plus
 * the Vega-Lite spec that produced it. Column types come from the values — text
 * becomes a category, numbers a quantity, ISO dates a time axis — so a bar,
 * line, area, point or arc chart needs no spec by hand. Pass `spec` to merge
 * extra Vega-Lite options over the generated one.
 * @param opts.rows Rows to chart, as objects keyed by column. Give rows or sql.
 * @param opts.sql Read-only DuckDB SQL producing the rows; needs the duckdb plugin.
 * @param opts.params Values bound to `?` placeholders of sql.
 * @param opts.db DuckDB database file for sql; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.mark Chart type. @default bar
 * @param opts.x Column for the x axis. Defaults to the first column.
 * @param opts.y Column for the y axis. Defaults to the first numeric column after x.
 * @param opts.color Column that splits the data into coloured series.
 * @param opts.title Chart title.
 * @param opts.sort Sort categories by value instead of by name. @default false
 * @param opts.width Chart width in pixels. @default 520 @minimum 50 @maximum 4000
 * @param opts.height Chart height in pixels. @default 240 @minimum 50 @maximum 4000
 * @param opts.maxRows Maximum rows drawn. @default 5000 @minimum 1 @maximum 50000
 * @param opts.spec Vega-Lite fields merged over the generated spec, for scales, axes, tooltips and the rest.
 * @returns The SVG and its HTML wrapper, the spec that was rendered, and the rows behind it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Rows to chart, as objects keyed by column. Give rows or sql. */
    rows?: Record<string, unknown>[];
    /** Read-only DuckDB SQL producing the rows; needs the duckdb plugin. */
    sql?: string;
    /** Values bound to `?` placeholders of sql. */
    params?: unknown[];
    /** DuckDB database file for sql; relative paths resolve in the workspace. Omit for the shared in-memory database. */
    db?: string;
    /** Chart type. @default bar */
    mark?: "bar" | "line" | "area" | "point" | "arc";
    /** Column for the x axis. Defaults to the first column. */
    x?: string;
    /** Column for the y axis. Defaults to the first numeric column after x. */
    y?: string;
    /** Column that splits the data into coloured series. */
    color?: string;
    /** Chart title. */
    title?: string;
    /** Sort categories by value instead of by name. @default false */
    sort?: boolean;
    /** Chart width in pixels. @default 520 @minimum 50 @maximum 4000 */
    width?: number;
    /** Chart height in pixels. @default 240 @minimum 50 @maximum 4000 */
    height?: number;
    /** Maximum rows drawn. @default 5000 @minimum 1 @maximum 50000 */
    maxRows?: number;
    /** Vega-Lite fields merged over the generated spec, for scales, axes, tooltips and the rest. */
    spec?: Record<string, unknown>;
}): Promise<{ html: string; svg: string; spec: Record<string, unknown>; rows: any[]; rowCount: number; truncated: boolean }> {
    const maxRows = Math.max(1, Math.min(Number(opts.maxRows ?? 5000), 50_000));
    if ((opts.rows === undefined) === (opts.sql === undefined)) throw new Error("vegalite.chart: give rows or sql");
    let result: { rows: any[]; rowCount: number; truncated: boolean };
    if (opts.sql !== undefined) {
        if (!(ctx.fns as any).duckdb?.query) throw new Error("vegalite.chart: sql needs the duckdb plugin, which is not mounted; pass rows instead");
        result = await (ctx.fns as any).duckdb.query({ sql: opts.sql, params: opts.params, db: opts.db, maxRows });
    } else {
        if (!Array.isArray(opts.rows)) throw new Error("vegalite.chart: rows must be an array of objects");
        result = { rows: opts.rows.slice(0, maxRows), rowCount: opts.rows.length, truncated: opts.rows.length > maxRows };
    }
    if (!result.rows.length) throw new Error("vegalite.chart: there are no rows to chart");

    const columns = [...new Set(result.rows.flatMap(row => Object.keys(row as Record<string, unknown>)))];
    const typeOf = (column: string): "quantitative" | "temporal" | "nominal" => {
        const values = result.rows.map(row => (row as Record<string, unknown>)[column]).filter(value => value !== null && value !== undefined);
        if (values.length && values.every(value => typeof value === "number")) return "quantitative";
        // normalize turns every DuckDB date and timestamp into an ISO string.
        if (values.length && values.every(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value))) return "temporal";
        return "nominal";
    };

    const x = opts.x ?? columns[0];
    if (!x || !columns.includes(x)) throw new Error(`vegalite.chart: no x column; the query returned ${columns.join(", ") || "nothing"}`);
    const y = opts.y ?? columns.find(column => column !== x && typeOf(column) === "quantitative");
    if (!y) throw new Error(`vegalite.chart: no numeric column to plot; the query returned ${columns.join(", ")}`);
    if (!columns.includes(y)) throw new Error(`vegalite.chart: column ${y} is not in the result (${columns.join(", ")})`);
    if (opts.color && !columns.includes(opts.color)) throw new Error(`vegalite.chart: column ${opts.color} is not in the result (${columns.join(", ")})`);

    const mark = opts.mark ?? "bar";
    const xType = typeOf(x);
    // A horizontal bar chart is the readable default for long category names,
    // and categories are exactly where the sort option is meaningful.
    const sortCategories = opts.sort ? { sort: ("-" + (mark === "arc" ? "theta" : "y")) as string } : {};
    const encoding: Record<string, unknown> = mark === "arc"
        ? { theta: { field: y, type: "quantitative" }, color: { field: opts.color ?? x, type: "nominal" } }
        : {
            x: { field: x, type: xType, ...(xType === "nominal" ? { axis: { labelAngle: 0 }, ...sortCategories } : {}) },
            y: { field: y, type: "quantitative" },
            ...(opts.color ? { color: { field: opts.color, type: typeOf(opts.color) } } : {}),
        };

    const spec: Record<string, unknown> = {
        ...(opts.title ? { title: opts.title } : {}),
        data: { values: result.rows },
        mark: mark === "point" ? { type: "point", filled: true } : mark,
        encoding,
        ...(opts.spec ?? {}),
    };
    const rendered = await ctx.fns.vegalite.render({ spec, width: opts.width ?? 520, height: opts.height ?? 240 });
    return { html: rendered.html, svg: rendered.svg, spec, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated };
}
