'use client';
/* eslint-disable @next/next/no-img-element -- static crest SVGs, like components/ui/crest.tsx */

import { useLayoutEffect, useRef, useState } from 'react'
import { Bar, Count, Follow, Phone, Stage, Swap, Window, type Act } from '@/components/stageshow'
import './slate-demo.css'

// Tonight's slate on pony xG: the game rail on the left, the selected game's
// preview on the right. Beats: the reader clicks down the rail, game two then
// game three, and the pane answers each click in place: the win bar slides
// to the new split, the percentages roll, the crests and goalies cross-fade,
// the factor bars re-balance. The fourth click goes back to the first game,
// which is the opening frame, so the loop seam is a real click.
//
// Real strings: the date, the tricodes on the bar, the goalies, the win %,
// the moneylines and xG. The factor labels and the cut-off fourth card are
// placeholder.

type Game = {
  a: string
  h: string
  ag: string
  hg: string
  /** Published away win % */
  p: number
  /** Vig-free market and raw model probability, away */
  mkt: number
  mdl: number
  ao: string
  ho: string
  axg: number
  hxg: number
  ac: string
  hc: string
  /** Factor balance, -1 (away) to 1 (home) */
  why: number[]
}

const GAMES: Game[] = [
  { a: 'UTA', h: 'TOR', ag: 'Cossa', hg: 'Bobrovsky', p: 56, mkt: 0.547, mdl: 0.58, ao: '−133', ho: '+112', axg: 3.5, hxg: 3.2, ac: '#71AFE5', hc: '#5B8EE8', why: [0.45, -0.85, -0.3, 0.12, -0.4, 0.2] },
  { a: 'WPG', h: 'MTL', ag: 'Daws', hg: 'Fowler', p: 32, mkt: 0.348, mdl: 0.3, ao: '+173', ho: '−205', axg: 2.5, hxg: 3.6, ac: '#2A6FC9', hc: '#AF1E2D', why: [0.5, 0.7, 0.2, 0.55, 0.35, -0.15] },
  { a: 'DET', h: 'TBL', ag: 'Gibson', hg: 'Vasilevskiy', p: 26, mkt: 0.298, mdl: 0.24, ao: '+225', ho: '−275', axg: 2.3, hxg: 3.9, ac: '#CE1126', hc: '#3278D4', why: [0.4, 0.8, 0.65, 0.6, 0.5, 0.3] },
]
const NEXT = { a: 'STL', h: 'NYR', ac: '#FCB514', hc: '#0083C6', p: 51 }

// The phone list runs longer, so there is somewhere to swipe to
const MORE: Game[] = [
  { a: 'STL', h: 'NYR', ag: 'Hofer', hg: 'Garand', p: 51, mkt: 0.476, mdl: 0.53, ao: '+100', ho: '−120', axg: 3.1, hxg: 3.0, ac: '#FCB514', hc: '#0083C6', why: [] },
  { a: 'MIN', h: 'PHI', ag: 'Wallstedt', hg: 'Woll', p: 62, mkt: 0.61, mdl: 0.64, ao: '−180', ho: '+155', axg: 3.3, hxg: 2.6, ac: '#2E8B57', hc: '#F74902', why: [] },
]

const crest = (tri: string) => `/logos/${tri}.svg`

const REST = { x: 300, y: 300 }
const REST_PHONE = { x: 250, y: 330 }

type S = { sel: number; off: number; thrown: boolean }
const initial: S = { sel: 0, off: 0, thrown: false }

async function script(a: Act<S>) {
  if (a.layout === 'compact') {
    // The phone column has no rail: the site stacks its cards, so the reader
    // swipes down tonight's games a card at a time, then flicks back to the top
    // The phone draws its screen scaled, so convert the measured card pitch
    // from stage pixels to the list's own pixels with a 100px probe
    const unit = a.rect('px-unit').width / 100
    const pitch = (a.rect('m1').y - a.rect('m0').y) / unit
    let off = 0
    const swipe = async (to: number) => {
      const x = 200
      const y0 = to > off ? 400 : 250
      const dy = to > off ? -120 : 120
      const base = off
      await a.move({ x, y: y0 })
      await a.drag({ x, y: y0 + dy }, at => a.put({ off: base + (y0 - at.y), thrown: false }), {
        duration: 260,
        path: (t, p0, p1) => ({ x: p0.x, y: p0.y + (p1.y - p0.y) * t }),
      })
      // The finger lifts at speed and the list is thrown the rest of the way
      a.put({ off: to, thrown: true })
      off = to
      await a.wait(520)
    }
    await a.wait(1200)
    a.mark('swipe-1')
    await swipe(pitch)
    await a.wait(1700)
    a.mark('swipe-2')
    await swipe(pitch * 2)
    await a.wait(1900)
    await swipe(0)
    await a.snap({ thrown: false })
    await a.move(REST_PHONE)
    await a.wait(900)
    return
  }
  // Aim at the empty middle of the goalie line, never at the bar's numbers
  const pick = async (i: number) => {
    await a.move({ at: `g${i}`, x: 0.5, y: 0.17 })
    await a.click()
    a.mark(`game-${i}`)
    a.put({ sel: i })
  }
  await a.wait(1100)
  await pick(1)
  await a.wait(2500)
  await pick(2)
  await a.wait(2800)
  await pick(0)
  await a.wait(1400)
  // Off the card again, to the opening rest, so the seam is still
  await a.move(REST)
  await a.wait(300)
}

// Below this container width the stage switches to the phone design
const BELOW = 700

export default function SlateDemo() {
  // The kit's cursor style is one per stage: the phone design wants a finger,
  // the desktop one an arrow, so pick it from the same width the stage uses
  const host = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setNarrow(e!.contentRect.width < BELOW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={host}>
    <Stage<S>
      width={760}
      height={500}
      compact={{ below: BELOW, width: 358, height: 500 }}
      theme="dark"
      initial={initial}
      poster={{ sel: 2, off: 0, thrown: false }}
      script={script}
      cursor={{ at: { wide: REST, compact: REST_PHONE }, style: narrow ? 'touch' : 'real' }}
      className="px"
    >
      {(s, rect, layout) => {
        const g = GAMES[s.sel]!
        if (layout === 'compact') return <Compact off={s.off} thrown={s.thrown} />
        return (
          <>
            <Window url="ponyxg.com" urlShape="pill" className="px-win">
              <div className="px-body">
                <div className="px-head">
                  <div className="px-date">Tue · Nov 3</div>
                  <span className="px-pill">
                    Tonight <b>11</b>
                  </span>
                </div>
                <div className="px-cols">
                  <div className="px-rail">
                    {GAMES.map((game, i) => (
                      <RailCard key={game.a} g={game} i={i} selected={s.sel === i} />
                    ))}
                    <div className="px-card px-card--next">
                      <div className="px-goalies">
                        <Bar w={44} h={6} tone={2} />
                        <Bar w={52} h={6} tone={2} />
                      </div>
                      <div className="px-match">
                        <img className="px-crest-sm" src={crest(NEXT.a)} alt="" />
                        <WinBar a={NEXT.a} h={NEXT.h} ac={NEXT.ac} hc={NEXT.hc} p={NEXT.p} size="sm" />
                        <img className="px-crest-sm" src={crest(NEXT.h)} alt="" />
                      </div>
                    </div>
                  </div>
                  <Pane g={g} sel={s.sel} />
                </div>
              </div>
            </Window>
            <Follow className="px-ring" to={rect(`g${s.sel}`)} stiffness={0.09} />
          </>
        )
      }}
    </Stage>
    </div>
  )
}

function Compact({ off, thrown }: { off: number; thrown: boolean }) {
  return (
    <Phone width={322} dark wallpaper="#05070b" className="px-phone">
      <div className="px-body">
        <div className="px-head">
          <div className="px-date">Tue · Nov 3</div>
          <span className="px-pill">
            Tonight <b>11</b>
          </span>
        </div>
        <span className="px-unit" data-target="px-unit" aria-hidden="true" />
        <div className="px-list">
          <div className="px-track-y" data-thrown={thrown || undefined} style={{ transform: `translateY(${-off}px)` }}>
            {[...GAMES, ...MORE].map((game, i) => (
              <MobileCard key={game.a} g={game} i={i} />
            ))}
          </div>
        </div>
      </div>
    </Phone>
  )
}

// The phone layout's card: time, crests with their goalies, the fat win bar,
// then the book price and our xG under each end
function MobileCard({ g, i }: { g: Game; i: number }) {
  return (
    <div className="px-mcard" data-target={`m${i}`}>
      <div className="px-time">6:00 PM CST</div>
      <div className="px-mteams">
        <span className="px-side">
          <img className="px-crest" data-on src={crest(g.a)} alt="" />
          <span className="px-g">{g.ag}</span>
        </span>
        <span className="px-at">@</span>
        <span className="px-side px-side--home">
          <img className="px-crest" data-on src={crest(g.h)} alt="" />
          <span className="px-g px-g--on">{g.hg}</span>
        </span>
      </div>
      <WinBar a={g.a} h={g.h} ac={g.ac} hc={g.hc} p={g.p} mkt={g.mkt} mdl={g.mdl} size="lg" />
      <div className="px-ends px-mends">
        <span>
          {g.a} <b>{g.ao}</b> xG <i>{g.axg.toFixed(1)}</i>
        </span>
        <span>
          xG <i>{g.hxg.toFixed(1)}</i> <b>{g.ho}</b> {g.h}
        </span>
      </div>
    </div>
  )
}

function RailCard({ g, i, selected }: { g: Game; i: number; selected: boolean }) {
  return (
    <div className="px-card" data-target={`g${i}`} data-cursor="pointer" data-selected={selected || undefined}>
      <div className="px-goalies">
        <span className="px-goalie">{g.ag}</span>
        <span className="px-goalie px-goalie--on">{g.hg}</span>
      </div>
      <div className="px-match">
        <img className="px-crest-sm" src={crest(g.a)} alt="" />
        <WinBar a={g.a} h={g.h} ac={g.ac} hc={g.hc} p={g.p} mkt={g.mkt} mdl={g.mdl} size="sm" />
        <img className="px-crest-sm" src={crest(g.h)} alt="" />
      </div>
      <div className="px-ends">
        <span>
          <b>{g.ao}</b> xG <i>{g.axg.toFixed(1)}</i>
        </span>
        <span>
          xG <i>{g.hxg.toFixed(1)}</i> <b>{g.ho}</b>
        </span>
      </div>
    </div>
  )
}

function Pane({ g, sel }: { g: Game; sel: number }) {
  return (
    <div className="px-pane">
      <div className="px-time">6:00 PM CST</div>
      <div className="px-hero">
        <Crests tri={GAMES.map(x => x.a)} sel={sel} />
        <div className="px-hero-mid">
          <WinBar a={g.a} h={g.h} ac={g.ac} hc={g.hc} p={g.p} mkt={g.mkt} mdl={g.mdl} size="lg" />
        </div>
        <Crests tri={GAMES.map(x => x.h)} sel={sel} />
      </div>
      <div className="px-lines">
        <span className="px-side">
          <Swap id={g.a} className="px-g">{g.ag}</Swap>
          <span className="px-ml">
            <Swap id={g.a}>
              {g.a} {g.ao}
            </Swap>
          </span>
        </span>
        <span className="px-xg">
          <span>xG</span>
          <Count value={g.axg * 10} format={n => (n / 10).toFixed(1)} />
          <span className="px-dim">vs</span>
          <Count value={g.hxg * 10} format={n => (n / 10).toFixed(1)} />
        </span>
        <span className="px-side px-side--home">
          <Swap id={g.h} className="px-g px-g--on">{g.hg}</Swap>
          <span className="px-ml">
            <Swap id={g.h}>
              {g.ho} {g.h}
            </Swap>
          </span>
        </span>
      </div>
      <div className="px-tabs">
        {['Preview', 'Lines', 'Odds', 'News'].map((t, i) => (
          <span key={t} className="px-tab" data-on={i === 0 || undefined}>
            {t}
          </span>
        ))}
      </div>
      <div className="px-why">
        {g.why.map((v, i) => (
          <div key={i} className="px-factor">
            <Bar w={[56, 34, 48, 40, 52, 44][i]} h={6} tone={2} />
            <span className="px-track">
              <span
                className="px-fill"
                style={{
                  left: v < 0 ? `${50 + v * 50}%` : '50%',
                  width: `${Math.abs(v) * 50}%`,
                  background: v < 0 ? g.ac : g.hc,
                }}
              />
            </span>
            <Bar w={30} h={6} tone={2} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Every game's crest is mounted in one cell; the selected one shows, so a
// change is a cross-fade in place, never an empty frame
function Crests({ tri, sel }: { tri: string[]; sel: number }) {
  return (
    <span className="px-crests">
      {tri.map((t, i) => (
        <img key={t} className="px-crest" src={crest(t)} alt="" data-on={i === sel || undefined} />
      ))}
    </span>
  )
}

// The site's two-team win bar: fills from both ends, the favourite glows and
// the underdog is dimmed, a white market tick and a magenta model diamond
function WinBar({ a, h, ac, hc, p, mkt, mdl, size }: { a: string; h: string; ac: string; hc: string; p: number; mkt?: number; mdl?: number; size: 'sm' | 'lg' }) {
  const q = 100 - p
  return (
    <span className="px-bar" data-size={size} aria-label={`${a} ${p}%, ${h} ${q}%`}>
      <span className="px-fill-a" data-dog={p < q || undefined} style={{ width: `${p}%`, '--c': ac } as React.CSSProperties} />
      <span className="px-fill-h" data-dog={q < p || undefined} style={{ width: `${q}%`, '--c': hc } as React.CSSProperties} />
      <span className="px-pct px-pct--a">
        <Count value={p} />
        <sup>%</sup>
      </span>
      <span className="px-pct px-pct--h">
        <Count value={q} />
        <sup>%</sup>
      </span>
      {mkt != null ? <span className="px-mkt" style={{ left: `${mkt * 100}%` }} /> : null}
      {mdl != null ? <span className="px-mdl" style={{ left: `${mdl * 100}%` }} /> : null}
    </span>
  )
}
