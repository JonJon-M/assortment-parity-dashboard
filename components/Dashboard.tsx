'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Row, PariySummary, MonthlyActive, CatParity, EfficientSku, MissingEfficient, InefficientStock, NosalesSku } from '@/lib/types'
import Chart from 'chart.js/auto'

const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#ec4899','#64748b','#06b6d4']
const PG = 50
const WH_T = 'NBOF1 - TIMAURD', WH_S = 'NBOF3 - SAFARI'

function fmt(n: number | null | undefined) { return n == null ? '—' : Number(n).toLocaleString() }
function fmtRev(n: number) { return 'KES ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function fmtPct(n: number | null) { return n == null ? '—' : Number(n).toFixed(1) + '%' }
function sparkBar(val: number, max: number, color = '#3b82f6') {
  const w = Math.round(Math.max(2, Math.min(80, (val / max) * 80)))
  return <span className="sparkbar" style={{ width: w, background: color }} />
}
function lastSoldTag(v: string | null) {
  if (!v) return <span className="tag tag-never">Never</span>
  const [y, m] = v.split('-').map(Number)
  const d = (2026 - y) * 12 + (4 - m)
  if (d <= 3) return <span className="tag tag-recent">{v}</span>
  if (d <= 9) return <span className="tag tag-old">{v}</span>
  return <span className="tag tag-never">{v}</span>
}
function WhTag({ w }: { w: string }) {
  const t = w.includes('TIMAURD') ? 'timaurd' : 'safari'
  return <span className={`tag-wh tag-${t}`}>{w.includes('TIMAURD') ? 'TIMAURD' : 'SAFARI'}</span>
}
function exportCSV(rows: Row[], filename: string) {
  if (!rows.length) return
  const keys = Object.keys(rows[0])
  const lines = [keys.join(','), ...rows.map(r => keys.map(k => {
    const v = r[k] ?? ''
    return typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? '"' + v.replace(/"/g, '""') + '"' : v
  }).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = filename + '_' + new Date().toISOString().slice(0, 10) + '.csv'
  a.click(); URL.revokeObjectURL(a.href)
}
function Loading() { return <div className="loading"><div className="spinner" /> Loading data…</div> }

function useSortFilter<T extends Row>(data: T[], defaultSort: keyof T) {
  const [q, setQ] = useState('')
  const [catQ, setCatQ] = useState('')
  const [sortCol, setSortCol] = useState<keyof T>(defaultSort)
  const [sortDir, setSortDir] = useState(-1)
  const [page, setPage] = useState(1)
  const sort = (col: string) => {
    const k = col as keyof T
    setSortDir(d => k === sortCol ? d * -1 : -1)
    setSortCol(k)
    setPage(1)
  }
  const filtered = data
    .filter(r => !q || ['sku','product_name','cat_l1'].some(k => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase())))
    .filter(r => !catQ || r.cat_l1 === catQ)
    .sort((a, b) => ((a[sortCol] ?? 0) < (b[sortCol] ?? 0) ? 1 : -1) * sortDir)
  const pages = Math.max(1, Math.ceil(filtered.length / PG))
  const safePage = Math.min(page, pages)
  return { q, setQ, catQ, setCatQ, sort, sortCol: sortCol as string, sortDir, page: safePage, setPage, pages, filtered, rows: filtered.slice((safePage - 1) * PG, safePage * PG) }
}

function Pagination({ page, pages, setPage, total }: { page: number; pages: number; setPage: (p: number) => void; total: number }) {
  if (pages <= 1) return null
  const start = Math.max(1, page - 2), end = Math.min(pages, page + 2)
  const btns: number[] = []; for (let i = start; i <= end; i++) btns.push(i)
  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => setPage(Math.max(1, page - 1))}>‹</button>
      {start > 1 && <><button className="page-btn" onClick={() => setPage(1)}>1</button>{start > 2 && <span className="page-info">…</span>}</>}
      {btns.map(i => <button key={i} className={`page-btn${i === page ? ' active' : ''}`} onClick={() => setPage(i)}>{i}</button>)}
      {end < pages && <>{end < pages - 1 && <span className="page-info">…</span>}<button className="page-btn" onClick={() => setPage(pages)}>{pages}</button></>}
      <button className="page-btn" onClick={() => setPage(Math.min(pages, page + 1))}>›</button>
      <span className="page-info">{page}/{pages} ({fmt(total)} rows)</span>
    </div>
  )
}

function SortTh({ col, label, sortCol, sortDir, onSort }: { col: string; label: string; sortCol: string; sortDir: number; onSort: (c: string) => void }) {
  return <th onClick={() => onSort(col)}>{label}{sortCol === col ? (sortDir === -1 ? ' ▼' : ' ▲') : ' '}</th>
}

function destroyAndCreate(instRef: React.MutableRefObject<Chart | null>, canvasRef: React.RefObject<HTMLCanvasElement | null>, cfg: object) {
  instRef.current?.destroy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (canvasRef.current) instRef.current = new Chart(canvasRef.current.getContext('2d')!, cfg as any)
}

// ══ TAB 1 – PARITY ═══════════════════════════════════════════════
function ParityTab({ summary, monthly, catParity }: { summary: PariySummary; monthly: MonthlyActive[]; catParity: CatParity[] }) {
  const [missWh, setMissWh] = useState<'T' | 'S'>('T')
  const [missData, setMissData] = useState<MissingEfficient[]>([])
  const [missLoading, setMissLoading] = useState(false)
  const splitRef = useRef<HTMLCanvasElement>(null)
  const trendRef = useRef<HTMLCanvasElement>(null)
  const stockTRef = useRef<HTMLCanvasElement>(null)
  const stockSRef = useRef<HTMLCanvasElement>(null)
  const catRef = useRef<HTMLCanvasElement>(null)
  const missTopRef = useRef<HTMLCanvasElement>(null)
  const missCatRef = useRef<HTMLCanvasElement>(null)
  const missTopInst = useRef<Chart | null>(null)
  const missCatInst = useRef<Chart | null>(null)
  const sf = useSortFilter<MissingEfficient>(missData, 'recent_qty')

  useEffect(() => {
    if (splitRef.current) new Chart(splitRef.current.getContext('2d')!, { type: 'doughnut', data: { labels: ['Both','TIMAURD Only','SAFARI Only'], datasets: [{ data: [summary.common_skus, summary.only_timaurd, summary.only_safari], backgroundColor: ['#3b82f6','#f97316','#22c55e'], borderWidth: 0 }] }, options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } }, cutout: '68%' } })
    const byMonth: Record<string, { t: number; s: number }> = {}
    monthly.forEach(r => { if (!byMonth[r.month]) byMonth[r.month] = { t: 0, s: 0 }; if (r.warehouse === WH_T) byMonth[r.month].t = r.active_skus; else byMonth[r.month].s = r.active_skus })
    const labels = Object.keys(byMonth).sort()
    if (trendRef.current) new Chart(trendRef.current.getContext('2d')!, { type: 'line', data: { labels, datasets: [{ label: 'TIMAURD', data: labels.map(m => byMonth[m].t), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.1)', tension: .35, pointRadius: 3 }, { label: 'SAFARI', data: labels.map(m => byMonth[m].s), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: .35, pointRadius: 3 }] }, options: { plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } }, scales: { x: { ticks: { color: '#64748b', maxRotation: 45, font: { size: 10 } }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' } } } } })
    const mkStock = (ref: React.RefObject<HTMLCanvasElement | null>, ins: number, zer: number) => { if (ref.current) new Chart(ref.current.getContext('2d')!, { type: 'doughnut', data: { labels: ['In Stock','Zero Stock'], datasets: [{ data: [ins, zer], backgroundColor: ['#22c55e','#334155'], borderWidth: 0 }] }, options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } }, cutout: '65%' } }) }
    mkStock(stockTRef, summary.timaurd_in_stock, summary.timaurd_zero_stock)
    mkStock(stockSRef, summary.safari_in_stock, summary.safari_zero_stock)
    const top = catParity.slice(0, 12)
    if (catRef.current) new Chart(catRef.current.getContext('2d')!, { type: 'bar', data: { labels: top.map(c => c.category), datasets: [{ label: 'TIMAURD', data: top.map(c => c.timaurd_count), backgroundColor: 'rgba(59,130,246,.8)' }, { label: 'SAFARI', data: top.map(c => c.safari_count), backgroundColor: 'rgba(34,197,94,.8)' }] }, options: { plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } }, scales: { x: { ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 35 }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' } } } } as object })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMiss = useCallback(async (wh: 'T' | 'S') => {
    setMissLoading(true)
    const { data } = await supabase.from('missing_efficient').select('*').eq('missing_from', wh === 'T' ? WH_T : WH_S).order('recent_qty', { ascending: false })
    setMissData(data ?? [])
    setMissLoading(false)
  }, [])

  useEffect(() => { loadMiss('T') }, [loadMiss])

  useEffect(() => {
    if (!missData.length) return
    const top = [...missData].sort((a, b) => b.recent_qty - a.recent_qty).slice(0, 10)
    const cats: Record<string, number> = {}; missData.forEach(r => { cats[r.cat_l1] = (cats[r.cat_l1] ?? 0) + 1 })
    const catItems = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 10)
    destroyAndCreate(missTopInst, missTopRef, { type: 'bar', data: { labels: top.map(r => r.product_name), datasets: [{ label: 'Recent Qty', data: top.map(r => r.recent_qty), backgroundColor: 'rgba(249,115,22,.8)' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' } } } } })
    destroyAndCreate(missCatInst, missCatRef, { type: 'doughnut', data: { labels: catItems.map(c => c[0]), datasets: [{ data: catItems.map(c => c[1]), backgroundColor: COLORS, borderWidth: 0 }] }, options: { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 10 }, padding: 8 } } }, cutout: '60%' } })
  }, [missData])

  const maxQty = Math.max(...sf.filtered.map(r => r.recent_qty), 1)

  return (
    <div className="container">
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Total Unique SKUs</div><div className="kpi-value">{fmt(summary.total_unique)}</div><div className="kpi-sub">Across both warehouses</div></div>
        <div className="kpi-card teal"><div className="kpi-label">TIMAURD In Stock</div><div className="kpi-value">{fmt(summary.timaurd_in_stock)}</div><div className="kpi-sub">of {fmt(summary.timaurd_total)} on record</div></div>
        <div className="kpi-card green"><div className="kpi-label">SAFARI In Stock</div><div className="kpi-value">{fmt(summary.safari_in_stock)}</div><div className="kpi-sub">of {fmt(summary.safari_total)} on record</div></div>
        <div className="kpi-card"><div className="kpi-label">SKUs in Both</div><div className="kpi-value">{fmt(summary.common_skus)}</div><div className="kpi-sub">{(summary.common_skus / summary.total_unique * 100).toFixed(1)}% overlap</div></div>
        <div className="kpi-card orange"><div className="kpi-label">TIMAURD Exclusive</div><div className="kpi-value">{fmt(summary.only_timaurd)}</div><div className="kpi-sub">Not in SAFARI</div></div>
        <div className="kpi-card purple"><div className="kpi-label">SAFARI Exclusive</div><div className="kpi-value">{fmt(summary.only_safari)}</div><div className="kpi-sub">Not in TIMAURD</div></div>
        <div className="kpi-card amber"><div className="kpi-label">Efficient Missing</div><div className="kpi-value">{fmt(summary.miss_eff_timaurd + summary.miss_eff_safari)}</div><div className="kpi-sub">Selling elsewhere, absent here</div></div>
        <div className="kpi-card red"><div className="kpi-label">Ineff (in-stock)</div><div className="kpi-value">{fmt(summary.ineff_stock_total)}</div><div className="kpi-sub">Zero sales — last 3m</div></div>
      </div>
      <div className="section">
        <div className="section-title"><span className="dot dot-blue" />SKU Overlap &amp; Stock Status</div>
        <div className="charts-row r2">
          <div className="chart-card">
            <h3>SKU Overlap Overview</h3>
            <div className="parity-boxes">
              <div className="parity-box blue"><div className="pv" style={{color:'#60a5fa'}}>{fmt(summary.common_skus)}</div><div className="pl">In Both</div><div className="pp" style={{color:'#60a5fa'}}>{(summary.common_skus/summary.total_unique*100).toFixed(1)}%</div></div>
              <div className="parity-box orange"><div className="pv" style={{color:'#fb923c'}}>{fmt(summary.only_timaurd)}</div><div className="pl">TIMAURD Only</div><div className="pp" style={{color:'#fb923c'}}>{(summary.only_timaurd/summary.total_unique*100).toFixed(1)}%</div></div>
              <div className="parity-box green"><div className="pv" style={{color:'#4ade80'}}>{fmt(summary.only_safari)}</div><div className="pl">SAFARI Only</div><div className="pp" style={{color:'#4ade80'}}>{(summary.only_safari/summary.total_unique*100).toFixed(1)}%</div></div>
            </div>
            <canvas ref={splitRef} height={160} />
          </div>
          <div className="chart-card"><h3>Monthly Active SKUs Trend</h3><canvas ref={trendRef} height={220} /></div>
        </div>
      </div>
      <div className="section">
        <div className="section-title"><span className="dot dot-green" />Stock Status Breakdown</div>
        <div className="charts-row r2">
          <div className="chart-card"><h3>TIMAURD Stock Distribution</h3><canvas ref={stockTRef} height={200} /></div>
          <div className="chart-card"><h3>SAFARI Stock Distribution</h3><canvas ref={stockSRef} height={200} /></div>
        </div>
      </div>
      <div className="section">
        <div className="section-title"><span className="dot dot-amber" />Category Depth Parity (Top 12)</div>
        <div className="charts-row"><div className="chart-card"><h3>SKU Count by Category per Warehouse</h3><canvas ref={catRef} height={220} /></div></div>
      </div>
      <div className="section">
        <div className="section-title"><span className="dot dot-orange" />Missing Efficient SKUs per Warehouse</div>
        <div className="note"><strong>Efficient SKUs</strong> are in-stock, actively selling, positive-margin products. These are selling well in one warehouse but completely absent from the other.</div>
        <div className="controls">
          <div className="wh-seg">
            <button className={`wh-seg-btn${missWh==='T'?' active':''}`} onClick={() => { setMissWh('T'); sf.setQ(''); sf.setPage(1); loadMiss('T') }}>TIMAURD → SAFARI</button>
            <button className={`wh-seg-btn${missWh==='S'?' active':''}`} onClick={() => { setMissWh('S'); sf.setQ(''); sf.setPage(1); loadMiss('S') }}>SAFARI → TIMAURD</button>
          </div>
          <span className="wh-label">{missWh==='T' ? `${fmt(summary.miss_eff_timaurd)} SKUs in TIMAURD missing from SAFARI` : `${fmt(summary.miss_eff_safari)} SKUs in SAFARI missing from TIMAURD`}</span>
          <button className="export-btn" onClick={() => exportCSV(sf.filtered, `missing_efficient_${missWh==='T'?'safari':'timaurd'}`)}>↓ Export CSV</button>
        </div>
        {missLoading ? <Loading /> : <>
          <div className="charts-row r2">
            <div className="chart-card"><h3>Top 10 Missing by Recent Qty</h3><canvas ref={missTopRef} height={240} /></div>
            <div className="chart-card"><h3>Missing SKUs by Category</h3><canvas ref={missCatRef} height={240} /></div>
          </div>
          <div className="table-wrapper">
            <div className="table-controls">
              <input className="search-box" placeholder="Search SKU / product / category…" value={sf.q} onChange={e => { sf.setQ(e.target.value); sf.setPage(1) }} />
              <span className="table-count">{fmt(sf.filtered.length)} SKUs</span>
              <button className="export-btn" onClick={() => exportCSV(sf.filtered, 'missing_efficient')}>↓ Export CSV</button>
            </div>
            <table><thead><tr>
              {(['sku','product_name','cat_l1','recent_qty','avg_monthly_qty','total_qty'] as const).map(c => <SortTh key={c} col={c} label={c==='sku'?'SKU':c==='product_name'?'Product':c==='cat_l1'?'Category':c==='recent_qty'?'Recent Qty':c==='avg_monthly_qty'?'Avg/Mo':'Total Qty'} sortCol={sf.sortCol} sortDir={sf.sortDir} onSort={sf.sort} />)}
            </tr></thead><tbody>{sf.rows.map((r,i) => <tr key={i}>
              <td style={{fontFamily:'monospace',color:'#60a5fa'}}>{r.sku}</td><td>{r.product_name}</td><td style={{color:'#94a3b8'}}>{r.cat_l1}</td>
              <td>{sparkBar(r.recent_qty,maxQty,'#f97316')} {fmt(r.recent_qty)}</td><td>{r.avg_monthly_qty?.toFixed(1)}</td><td>{fmt(r.total_qty)}</td>
            </tr>)}</tbody></table>
            <Pagination page={sf.page} pages={sf.pages} setPage={sf.setPage} total={sf.filtered.length} />
          </div>
        </>}
      </div>
    </div>
  )
}

// ══ TAB 2 – EFFICIENT SKUs ════════════════════════════════════════
function EfficientTab() {
  const [wh, setWh] = useState<'T'|'S'>('T')
  const [data, setData] = useState<EfficientSku[]>([])
  const [loading, setLoading] = useState(true)
  const topRef = useRef<HTMLCanvasElement>(null); const catRef = useRef<HTMLCanvasElement>(null)
  const topInst = useRef<Chart|null>(null); const catInst = useRef<Chart|null>(null)

  useEffect(() => { supabase.from('efficient_skus').select('*').order('recent_qty',{ascending:false}).then(({data:d})=>{setData(d??[]);setLoading(false)}) }, [])

  const whData = data.filter(r => r.warehouse === (wh==='T'?WH_T:WH_S))
  const sf = useSortFilter<EfficientSku>(whData, 'recent_qty')
  const cats = [...new Set(whData.map(r=>r.cat_l1))].sort()
  const maxQty = Math.max(...whData.map(r=>r.recent_qty), 1)
  const rq = whData.reduce((s,r)=>s+r.recent_qty,0)
  const rr = whData.reduce((s,r)=>s+r.recent_rev,0)
  const margins = whData.filter(r=>r.recent_margin!=null).map(r=>r.recent_margin)
  const avgM = margins.length ? margins.reduce((a,b)=>a+b,0)/margins.length : 0

  const buildCharts = useCallback((rows: EfficientSku[]) => {
    const top = rows.slice(0,10)
    const cm: Record<string,[number,number]> = {}; rows.forEach(r=>{if(!cm[r.cat_l1])cm[r.cat_l1]=[0,0];cm[r.cat_l1][0]++;cm[r.cat_l1][1]+=r.recent_qty})
    const ci = Object.entries(cm).sort((a,b)=>b[1][1]-a[1][1]).slice(0,10)
    destroyAndCreate(topInst,topRef,{type:'bar',data:{labels:top.map(r=>r.product_name),datasets:[{label:'Recent Qty',data:top.map(r=>r.recent_qty),backgroundColor:'rgba(59,130,246,.8)'}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'#1e293b'}}}}})
    destroyAndCreate(catInst,catRef,{type:'bar',data:{labels:ci.map(c=>c[0]),datasets:[{label:'SKU Count',data:ci.map(c=>c[1][0]),backgroundColor:'rgba(59,130,246,.8)',yAxisID:'y'},{label:'Recent Qty',data:ci.map(c=>c[1][1]),backgroundColor:'rgba(34,197,94,.6)',yAxisID:'y1'}]},options:{plugins:{legend:{labels:{color:'#94a3b8',boxWidth:12,font:{size:11}}}},scales:{x:{ticks:{color:'#64748b',font:{size:10},maxRotation:35},grid:{color:'#1e293b'}},y:{type:'linear',position:'left',ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}},y1:{type:'linear',position:'right',ticks:{color:'#64748b',font:{size:10}},grid:{drawOnChartArea:false}}}}})
  },[])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!loading)buildCharts(whData)},[loading,wh])

  if (loading) return <div className="container"><Loading /></div>
  return (
    <div className="container">
      <div className="note"><strong>Efficient SKUs:</strong> In-stock, actively selling with positive margins. Discount-driven/clearance (&le;0% avg margin) excluded.</div>
      <div className="controls">
        <span style={{color:'#94a3b8',fontSize:13,fontWeight:600}}>Warehouse:</span>
        <select className="wh-dropdown" value={wh} onChange={e=>{setWh(e.target.value as 'T'|'S');sf.setQ('');sf.setCatQ('');sf.setPage(1)}}>
          <option value="T">NBOF1 - TIMAURD</option><option value="S">NBOF3 - SAFARI</option>
        </select>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card teal"><div className="kpi-label">Efficient SKUs</div><div className="kpi-value">{fmt(whData.length)}</div><div className="kpi-sub">In stock &amp; selling</div></div>
        <div className="kpi-card green"><div className="kpi-label">Recent Qty Sold</div><div className="kpi-value">{fmt(rq)}</div><div className="kpi-sub">Last 3 months</div></div>
        <div className="kpi-card"><div className="kpi-label">Recent Revenue</div><div className="kpi-value">{fmtRev(rr)}</div><div className="kpi-sub">Last 3 months</div></div>
        <div className="kpi-card amber"><div className="kpi-label">Avg Margin</div><div className="kpi-value">{fmtPct(avgM)}</div><div className="kpi-sub">Recent period</div></div>
      </div>
      <div className="charts-row r2">
        <div className="chart-card"><h3>Top 10 SKUs by Recent Qty</h3><canvas ref={topRef} height={260} /></div>
        <div className="chart-card"><h3>SKUs &amp; Volume by Category</h3><canvas ref={catRef} height={260} /></div>
      </div>
      <div className="table-wrapper">
        <div className="table-controls">
          <input className="search-box" placeholder="Search SKU / product / category…" value={sf.q} onChange={e=>{sf.setQ(e.target.value);sf.setPage(1)}} />
          <select className="filter-select" value={sf.catQ} onChange={e=>{sf.setCatQ(e.target.value);sf.setPage(1)}}>
            <option value="">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <span className="table-count">{fmt(sf.filtered.length)} SKUs</span>
          <button className="export-btn" onClick={()=>exportCSV(sf.filtered,`efficient_skus_${wh==='T'?'timaurd':'safari'}`)}>↓ Export CSV</button>
        </div>
        <table><thead><tr>
          {(['sku','product_name','cat_l1','stock_on_hand','recent_qty','total_qty','avg_monthly_qty','recent_margin'] as const).map(c=><SortTh key={c} col={c} label={c==='sku'?'SKU':c==='product_name'?'Product':c==='cat_l1'?'Category':c==='stock_on_hand'?'Stock':c==='recent_qty'?'Recent Qty':c==='total_qty'?'Total Qty':c==='avg_monthly_qty'?'Avg/Mo':'Margin %'} sortCol={sf.sortCol} sortDir={sf.sortDir} onSort={sf.sort} />)}
        </tr></thead><tbody>{sf.rows.map((r,i)=>{
          const mc=r.recent_margin==null?'#94a3b8':r.recent_margin<15?'#ef4444':r.recent_margin<30?'#f59e0b':'#22c55e'
          return <tr key={i}><td style={{fontFamily:'monospace',color:'#60a5fa'}}>{r.sku}</td><td>{r.product_name}</td><td style={{color:'#94a3b8'}}>{r.cat_l1}</td><td>{fmt(r.stock_on_hand)}</td><td>{sparkBar(r.recent_qty,maxQty,'#3b82f6')} {fmt(r.recent_qty)}</td><td>{fmt(r.total_qty)}</td><td>{r.avg_monthly_qty?.toFixed(1)}</td><td style={{color:mc,fontWeight:600}}>{r.recent_margin!=null?r.recent_margin.toFixed(1)+'%':'—'}</td></tr>
        })}</tbody></table>
        <Pagination page={sf.page} pages={sf.pages} setPage={sf.setPage} total={sf.filtered.length} />
      </div>
    </div>
  )
}

// ══ TAB 3 – INEFFICIENT SKUs ══════════════════════════════════════
function IneffTab({ recentMonths }: { recentMonths: string[] }) {
  const [whFilter, setWhFilter] = useState<'ALL'|'T'|'S'>('ALL')
  const [data, setData] = useState<InefficientStock[]>([])
  const [loading, setLoading] = useState(true)
  const topRef = useRef<HTMLCanvasElement>(null); const catRef = useRef<HTMLCanvasElement>(null)
  const topInst = useRef<Chart|null>(null); const catInst = useRef<Chart|null>(null)

  useEffect(()=>{supabase.from('inefficient_stock').select('*').order('stock_on_hand',{ascending:false}).then(({data:d})=>{setData(d??[]);setLoading(false)})},[])

  const fd = whFilter==='ALL'?data:data.filter(r=>r.warehouse===(whFilter==='T'?WH_T:WH_S))
  const sf = useSortFilter<InefficientStock>(fd,'stock_on_hand')
  const cats = [...new Set(fd.map(r=>r.cat_l1))].sort()
  const maxStk = Math.max(...fd.map(r=>r.stock_on_hand),1)

  const buildCharts = useCallback((rows: InefficientStock[])=>{
    const top = rows.slice(0,10)
    const cm: Record<string,number>={}; rows.forEach(r=>{cm[r.cat_l1]=(cm[r.cat_l1]??0)+1})
    const ci = Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,10)
    destroyAndCreate(topInst,topRef,{type:'bar',data:{labels:top.map(r=>r.product_name),datasets:[{label:'Stock on Hand',data:top.map(r=>r.stock_on_hand),backgroundColor:'rgba(239,68,68,.8)'}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'#1e293b'}}}}})
    destroyAndCreate(catInst,catRef,{type:'doughnut',data:{labels:ci.map(c=>c[0]),datasets:[{data:ci.map(c=>c[1]),backgroundColor:COLORS,borderWidth:0}]},options:{plugins:{legend:{position:'right',labels:{color:'#94a3b8',boxWidth:12,font:{size:10},padding:8}}},cutout:'60%'}})
  },[])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!loading)buildCharts(fd)},[loading,whFilter])

  if (loading) return <div className="container"><Loading /></div>
  return (
    <div className="container">
      <div className="note"><strong>Inefficient SKUs:</strong> Products currently <strong>in stock</strong> with <strong>zero sales in the last 3 months</strong> ({recentMonths.join(', ')}). Stranded working capital.</div>
      <div className="controls">
        <div className="wh-seg">
          {(['ALL','T','S'] as const).map(w=><button key={w} className={`wh-seg-btn${whFilter===w?' active':''}`} onClick={()=>{setWhFilter(w);sf.setQ('');sf.setCatQ('');sf.setPage(1)}}>{w==='ALL'?'All Warehouses':w==='T'?'TIMAURD':'SAFARI'}</button>)}
        </div>
        <button className="export-btn" onClick={()=>exportCSV(sf.filtered,`inefficient_stranded_${whFilter.toLowerCase()}`)}>↓ Export CSV</button>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card red"><div className="kpi-label">Stranded SKUs</div><div className="kpi-value">{fmt(fd.length)}</div><div className="kpi-sub">{whFilter==='ALL'?'All':whFilter==='T'?'TIMAURD':'SAFARI'}</div></div>
        <div className="kpi-card orange"><div className="kpi-label">Total Stock on Hand</div><div className="kpi-value">{fmt(fd.reduce((s,r)=>s+r.stock_on_hand,0))}</div><div className="kpi-sub">Units with no recent sales</div></div>
        <div className="kpi-card amber"><div className="kpi-label">Never Sold</div><div className="kpi-value">{fmt(fd.filter(r=>!r.total_qty_ever).length)}</div><div className="kpi-sub">Zero historical sales</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Categories</div><div className="kpi-value">{new Set(fd.map(r=>r.cat_l1)).size}</div><div className="kpi-sub">Product categories</div></div>
      </div>
      <div className="charts-row r2">
        <div className="chart-card"><h3>Top 10 by Stock on Hand</h3><canvas ref={topRef} height={260} /></div>
        <div className="chart-card"><h3>SKUs by Category</h3><canvas ref={catRef} height={260} /></div>
      </div>
      <div className="table-wrapper">
        <div className="table-controls">
          <input className="search-box" placeholder="Search SKU / product / category…" value={sf.q} onChange={e=>{sf.setQ(e.target.value);sf.setPage(1)}} />
          <select className="filter-select" value={sf.catQ} onChange={e=>{sf.setCatQ(e.target.value);sf.setPage(1)}}>
            <option value="">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <span className="table-count">{fmt(sf.filtered.length)} SKUs</span>
          <button className="export-btn" onClick={()=>exportCSV(sf.filtered,'inefficient_stranded')}>↓ Export CSV</button>
        </div>
        <table><thead><tr>
          {(['warehouse','sku','product_name','cat_l1','stock_on_hand','total_qty_ever','last_month_sold','avg_monthly_qty','months_listed'] as const).map(c=><SortTh key={c} col={c} label={c==='warehouse'?'WH':c==='sku'?'SKU':c==='product_name'?'Product':c==='cat_l1'?'Category':c==='stock_on_hand'?'Stock':c==='total_qty_ever'?'Total Qty Ever':c==='last_month_sold'?'Last Sold':c==='avg_monthly_qty'?'Avg/Mo':'Months'} sortCol={sf.sortCol} sortDir={sf.sortDir} onSort={sf.sort} />)}
        </tr></thead><tbody>{sf.rows.map((r,i)=><tr key={i}>
          <td><WhTag w={r.warehouse} /></td>
          <td style={{fontFamily:'monospace',color:'#60a5fa'}}>{r.sku}</td><td>{r.product_name}</td><td style={{color:'#94a3b8'}}>{r.cat_l1}</td>
          <td>{sparkBar(r.stock_on_hand,maxStk,'#ef4444')} {fmt(r.stock_on_hand)}</td><td>{fmt(r.total_qty_ever)}</td>
          <td>{lastSoldTag(r.last_month_sold)}</td><td>{r.avg_monthly_qty?.toFixed(1)}</td><td style={{textAlign:'center'}}>{r.months_listed}</td>
        </tr>)}</tbody></table>
        <Pagination page={sf.page} pages={sf.pages} setPage={sf.setPage} total={sf.filtered.length} />
      </div>
    </div>
  )
}

// ══ TAB 4 – NO SALES (broad) ══════════════════════════════════════
function NosalesTab({ recentMonths }: { recentMonths: string[] }) {
  const [wh, setWh] = useState<'T'|'S'>('T')
  const [data, setData] = useState<NosalesSku[]>([])
  const [loading, setLoading] = useState(true)
  const topRef = useRef<HTMLCanvasElement>(null); const catRef = useRef<HTMLCanvasElement>(null)
  const topInst = useRef<Chart|null>(null); const catInst = useRef<Chart|null>(null)

  useEffect(()=>{supabase.from('nosales_skus').select('*').order('total_qty_ever',{ascending:false}).then(({data:d})=>{setData(d??[]);setLoading(false)})},[])

  const whData = data.filter(r=>r.warehouse===(wh==='T'?WH_T:WH_S))
  const sf = useSortFilter<NosalesSku>(whData,'total_qty_ever')
  const cats = [...new Set(whData.map(r=>r.cat_l1))].sort()
  const maxQty = Math.max(...whData.map(r=>r.total_qty_ever),1)

  const buildCharts = useCallback((rows: NosalesSku[])=>{
    const top = rows.slice(0,10)
    const cm: Record<string,number>={}; rows.forEach(r=>{cm[r.cat_l1]=(cm[r.cat_l1]??0)+1})
    const ci = Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,10)
    destroyAndCreate(topInst,topRef,{type:'bar',data:{labels:top.map(r=>r.product_name),datasets:[{label:'Total Qty Ever',data:top.map(r=>r.total_qty_ever),backgroundColor:'rgba(168,85,247,.8)'}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'#1e293b'}}}}})
    destroyAndCreate(catInst,catRef,{type:'doughnut',data:{labels:ci.map(c=>c[0]),datasets:[{data:ci.map(c=>c[1]),backgroundColor:COLORS,borderWidth:0}]},options:{plugins:{legend:{position:'right',labels:{color:'#94a3b8',boxWidth:12,font:{size:10},padding:8}}},cutout:'60%'}})
  },[])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!loading)buildCharts(whData)},[loading,wh])

  if (loading) return <div className="container"><Loading /></div>
  return (
    <div className="container">
      <div className="note"><strong>Efficient SKUs with No Sales:</strong> All SKUs with zero sales in the last 3 months ({recentMonths.join(', ')}), regardless of stock status. TIMAURD: <strong>{fmt(data.filter(r=>r.warehouse===WH_T).length)}</strong> | SAFARI: <strong>{fmt(data.filter(r=>r.warehouse===WH_S).length)}</strong>.</div>
      <div className="controls">
        <span style={{color:'#94a3b8',fontSize:13,fontWeight:600}}>Warehouse:</span>
        <select className="wh-dropdown" value={wh} onChange={e=>{setWh(e.target.value as 'T'|'S');sf.setQ('');sf.setCatQ('');sf.setPage(1)}}>
          <option value="T">NBOF1 - TIMAURD</option><option value="S">NBOF3 - SAFARI</option>
        </select>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card purple"><div className="kpi-label">No-Sales SKUs</div><div className="kpi-value">{fmt(whData.length)}</div><div className="kpi-sub">{wh==='T'?'TIMAURD':'SAFARI'}</div></div>
        <div className="kpi-card red"><div className="kpi-label">Never Sold</div><div className="kpi-value">{fmt(whData.filter(r=>!r.total_qty_ever).length)}</div><div className="kpi-sub">Zero historical sales</div></div>
        <div className="kpi-card"><div className="kpi-label">Categories</div><div className="kpi-value">{new Set(whData.map(r=>r.cat_l1)).size}</div><div className="kpi-sub">Product categories</div></div>
      </div>
      <div className="charts-row r2">
        <div className="chart-card"><h3>Top 10 by Historical Qty</h3><canvas ref={topRef} height={260} /></div>
        <div className="chart-card"><h3>SKUs by Category</h3><canvas ref={catRef} height={260} /></div>
      </div>
      <div className="table-wrapper">
        <div className="table-controls">
          <input className="search-box" placeholder="Search SKU / product / category…" value={sf.q} onChange={e=>{sf.setQ(e.target.value);sf.setPage(1)}} />
          <select className="filter-select" value={sf.catQ} onChange={e=>{sf.setCatQ(e.target.value);sf.setPage(1)}}>
            <option value="">All Categories</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <span className="table-count">{fmt(sf.filtered.length)} SKUs</span>
          <button className="export-btn" onClick={()=>exportCSV(sf.filtered,`no_sales_${wh==='T'?'timaurd':'safari'}`)}>↓ Export CSV</button>
        </div>
        <table><thead><tr>
          {(['sku','product_name','cat_l1','cat_l2','total_qty_ever','last_month_sold'] as const).map(c=><SortTh key={c} col={c} label={c==='sku'?'SKU':c==='product_name'?'Product':c==='cat_l1'?'Category':c==='cat_l2'?'Subcategory':c==='total_qty_ever'?'Total Qty Ever':'Last Sold'} sortCol={sf.sortCol} sortDir={sf.sortDir} onSort={sf.sort} />)}
        </tr></thead><tbody>{sf.rows.map((r,i)=><tr key={i}>
          <td style={{fontFamily:'monospace',color:'#60a5fa'}}>{r.sku}</td><td>{r.product_name}</td><td style={{color:'#94a3b8'}}>{r.cat_l1}</td><td style={{color:'#64748b'}}>{r.cat_l2}</td>
          <td>{sparkBar(r.total_qty_ever,maxQty,'#a855f7')} {fmt(r.total_qty_ever)}</td><td>{lastSoldTag(r.last_month_sold)}</td>
        </tr>)}</tbody></table>
        <Pagination page={sf.page} pages={sf.pages} setPage={sf.setPage} total={sf.filtered.length} />
      </div>
    </div>
  )
}

// ══ MAIN ══════════════════════════════════════════════════════════
export default function Dashboard() {
  const [tab, setTab] = useState('parity')
  const [summary, setSummary] = useState<PariySummary|null>(null)
  const [monthly, setMonthly] = useState<MonthlyActive[]>([])
  const [catParity, setCatParity] = useState<CatParity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    Promise.all([
      supabase.from('parity_summary').select('*').single(),
      supabase.from('monthly_active').select('*').order('month'),
      supabase.from('cat_parity').select('*').order('timaurd_count',{ascending:false}),
    ]).then(([s,m,c])=>{ setSummary(s.data); setMonthly(m.data??[]); setCatParity(c.data??[]); setLoading(false) })
  },[])

  const tabs = [{id:'parity',label:'Assortment Parity'},{id:'efficient',label:'Efficient SKUs'},{id:'inefficient',label:'Inefficient SKUs'},{id:'nosales',label:'Efficient SKUs with No Sales'}]

  return (
    <>
      <div className="header">
        <h1>Assortment Parity &amp; SKU Performance Dashboard</h1>
        <p>TIMAURD (merged TIMAURD + VALLEYRD) vs SAFARI — live data from Supabase</p>
        {summary && <div className="header-meta">
          <div className="badge">Data range: <span>Jan 2025 – Apr 2026</span></div>
          <div className="badge">Recent period: <span>{summary.recent_months.join(', ')}</span></div>
          <div className="badge">Unique SKUs: <span>{fmt(summary.total_unique)}</span></div>
          <div className="badge">Efficient SKUs: <span>{fmt(summary.eff_count_timaurd+summary.eff_count_safari)}</span></div>
          <div className="badge">Inefficient (in-stock): <span>{fmt(summary.ineff_stock_total)}</span></div>
          <div className="badge">Discount-driven removed: <span>{summary.discount_removed}</span></div>
        </div>}
      </div>
      <div className="tab-bar">
        {tabs.map(t=><button key={t.id} className={`tab-btn${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>)}
      </div>
      {loading ? <div className="container"><Loading /></div> : <>
        {tab==='parity' && <ParityTab summary={summary!} monthly={monthly} catParity={catParity} />}
        {tab==='efficient' && <EfficientTab />}
        {tab==='inefficient' && <IneffTab recentMonths={summary!.recent_months} />}
        {tab==='nosales' && <NosalesTab recentMonths={summary!.recent_months} />}
      </>}
    </>
  )
}
