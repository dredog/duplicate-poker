import { useState, useCallback, useRef, useEffect } from "react";

// ─── Sound Effects (Web Audio API) ───
const AudioCtx=window.AudioContext||window.webkitAudioContext
let _actx=null
function getAudioCtx(){if(!_actx)_actx=new AudioCtx();return _actx}
function playDing(){try{const ctx=getAudioCtx(),o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(880,ctx.currentTime);o.frequency.setValueAtTime(1174,ctx.currentTime+0.08);o.type="sine";g.gain.setValueAtTime(0.15,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.3)}catch(e){}}
function playChipRattle(){try{const ctx=getAudioCtx();for(let i=0;i<5;i++){const t=ctx.currentTime+i*0.04+Math.random()*0.02;const buf=ctx.createBuffer(1,ctx.sampleRate*0.03,ctx.sampleRate),d=buf.getChannelData(0);for(let j=0;j<d.length;j++)d[j]=(Math.random()*2-1)*0.15;const s=ctx.createBufferSource(),g=ctx.createGain(),f=ctx.createBiquadFilter();f.type="bandpass";f.frequency.value=3000+Math.random()*3000;f.Q.value=2;s.buffer=buf;s.connect(f);f.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(0.12,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);s.start(t)}}catch(e){}}

import * as DB from "./db";



// ═══════════════════════════════════════════════
// RATING SYSTEM (Weighted Career Matchpoint %)
// Your rating IS your number: "I'm a 57" = you beat field 57%
// Recent sessions weighted 2x heavier than older ones
// ═══════════════════════════════════════════════
function tierInfo(pct) {
  if (pct >= 60) return { name: "Diamond", color: "#a855f7", icon: "💎" }
  if (pct >= 53) return { name: "Platinum", color: "#22d3ee", icon: "⭐" }
  if (pct >= 48) return { name: "Gold", color: "#f1c40f", icon: "🥇" }
  if (pct >= 42) return { name: "Silver", color: "#94a3b8", icon: "🥈" }
  return { name: "Bronze", color: "#cd7f32", icon: "🥉" }
}
function makeProfile(name) {
  return { name, sessions: 0, totalMP: 0, totalMaxMP: 0, totalIMPs: 0, bestPct: 0, history: [] }
}
function calcWeightedRating(history) {
  if (!history || history.length === 0) return null
  // Weight recent sessions 2x. Last 5 sessions get weight 2, older get weight 1
  let wSum = 0, wCount = 0
  for (let i = 0; i < history.length; i++) {
    const recency = (i >= history.length - 5) ? 2 : 1
    wSum += history[i].mpPct * recency
    wCount += recency
  }
  return wCount > 0 ? +(wSum / wCount).toFixed(1) : 50
}
async function updateRating(name, mpPct, maxMP, totalMP, imps, roomCode, orbits) {
  let prof = await DB.getProfile(name) || makeProfile(name)
  prof.sessions++
  prof.totalMP += totalMP
  prof.totalMaxMP += maxMP
  prof.totalIMPs += imps
  if (mpPct > prof.bestPct) prof.bestPct = mpPct
  const prev = calcWeightedRating(prof.history)
  prof.history.push({ date: Date.now(), room: roomCode, orbits, mpPct: +mpPct })
  if (prof.history.length > 50) prof.history = prof.history.slice(-50)
  const rating = calcWeightedRating(prof.history)
  await DB.saveProfile(name, prof)
  return { prof, rating, prev, delta: prev !== null ? +(rating - prev).toFixed(1) : null }
}

// Update AI bot profiles after a session completes
async function updateBotRatings(roomCode, totalOrbits, seeds) {
  try {
    const room = await DB.getRoom(roomCode)
    if (!room) return
    // For each orbit, collect all PnLs (humans + AI bots)
    const botTotals = {} // botName -> {mp, maxMp}
    AI_PROFILES.forEach(p => { botTotals[p.name] = { mp: 0, maxMp: 0 } })
    for (let o = 1; o <= totalOrbits; o++) {
      const allPnls = [] // {name, pnl}
      // Recompute AI results (deterministic)
      for (let i = 0; i < NUM_AI; i++) {
        const pnl = simOrbit(seeds[o - 1], 0, i)
        allPnls.push({ name: AI_PROFILES[i].name, pnl, isBot: true })
      }
      // Gather human results
      for (const p of room.players) {
        const r = await DB.getOrbitResult(roomCode, p.num, o)
        if (r) allPnls.push({ name: p.name, pnl: r.pnl, isBot: false })
      }
      // Compute matchpoints for each bot
      for (const bot of allPnls.filter(x => x.isBot)) {
        const opponents = allPnls.filter(x => x.name !== bot.name)
        let mp = 0
        for (const opp of opponents) { if (bot.pnl > opp.pnl) mp += 1; else if (bot.pnl === opp.pnl) mp += 0.5 }
        botTotals[bot.name].mp += mp
        botTotals[bot.name].maxMp += opponents.length
      }
    }
    // Update each bot's profile
    for (const [botName, totals] of Object.entries(botTotals)) {
      if (totals.maxMp === 0) continue
      const mpPct = +(totals.mp / totals.maxMp * 100).toFixed(1)
      let prof = await DB.getProfile(botName) || makeProfile(botName)
      prof.isBot = true
      prof.sessions++
      prof.totalMP += totals.mp
      prof.totalMaxMP += totals.maxMp
      const prev = calcWeightedRating(prof.history)
      prof.history.push({ date: Date.now(), room: roomCode, orbits: totalOrbits, mpPct })
      if (prof.history.length > 50) prof.history = prof.history.slice(-50)
      if (mpPct > prof.bestPct) prof.bestPct = mpPct
      await DB.saveProfile(botName, prof)
    }
  } catch (e) { console.error("Bot rating update error:", e) }
}
function ratingColor(r) { return tierInfo(r).color }
function ratingTitle(r) { return tierInfo(r).name }


// ═══════════════════════════════════════════════
// DUPLICATE POKER v7 — Fully Async 2-Player
// Play on your own time, compare later
// ═══════════════════════════════════════════════

const SUITS = ["♠","♥","♦","♣"]
const SC = {"♠":"#1a1a2e","♥":"#c0392b","♦":"#c0392b","♣":"#1a1a2e"}
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"]
const RD = {T:"10",J:"J",Q:"Q",K:"K",A:"A"}
const RV = {}; RANKS.forEach((r,i)=>RV[r]=i+2)

const STARTING = 1000, SB=5, BB=10, ANTE=5
const HANDS_PER_ORBIT = 6
const DEFAULT_ORBITS = 5
const NUM_AI = 5
const MAX_RAISES = 4

// ═══════════════════════════════════════════════
// ENGINE (deck, eval, AI, betting, pots)
// ═══════════════════════════════════════════════
function mkDeck(){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({rank:r,suit:s});return d}
function mkRng(seed){let s=((seed%2147483647)+2147483647)%2147483647;if(!s)s=1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646}}
function shuf(d,r){const a=[...d];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function cd(c){return(RD[c.rank]||c.rank)+c.suit}
function cv(c){return RV[c.rank]}

function evalHand(hole,comm){const all=[...hole,...comm];if(all.length<5)return[0];let best=[0];for(const c of combos(all,5)){const r=rank5(c);if(cmpR(r,best)>0)best=r}return best}
function combos(a,k){if(k===0)return[[]];if(a.length<k)return[];const[f,...r]=a,res=[];for(const c of combos(r,k-1))res.push([f,...c]);for(const c of combos(r,k))res.push(c);return res}
function rank5(cards){
  const v=cards.map(cv).sort((a,b)=>b-a),ss=cards.map(c=>c.suit),fl=ss.every(s=>s===ss[0])
  const cnt={};v.forEach(x=>cnt[x]=(cnt[x]||0)+1)
  const g=Object.entries(cnt).map(([x,c])=>[c,+x]).sort((a,b)=>b[0]-a[0]||b[1]-a[1])
  const str=(v[0]-v[4]===4&&new Set(v).size===5)||(v[0]===14&&v[1]===5&&v[2]===4&&v[3]===3&&v[4]===2)
  const sh=v[0]===14&&v[1]===5?5:v[0]
  if(fl&&str)return[8,sh];if(g[0][0]===4)return[7,g[0][1],g[1][1]]
  if(g[0][0]===3&&g[1][0]===2)return[6,g[0][1],g[1][1]];if(fl)return[5,...v]
  if(str)return[4,sh];if(g[0][0]===3)return[3,g[0][1],...g.slice(1).map(x=>x[1])]
  if(g[0][0]===2&&g[1][0]===2)return[2,Math.max(g[0][1],g[1][1]),Math.min(g[0][1],g[1][1]),g[2][1]]
  if(g[0][0]===2)return[1,g[0][1],...g.slice(1).map(x=>x[1])];return[0,...v]
}
function cmpR(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)>(b[i]||0))return 1;if((a[i]||0)<(b[i]||0))return-1}return 0}
const HN=["High Card","Pair","Two Pair","Trips","Straight","Flush","Full House","Quads","Straight Flush"]
function handName(r){return HN[r[0]]||""}

function detectDraws(hole,community){
  const all=[...hole,...community],dr={flushDraw:false,oesd:false,gutshot:false,equity:0}
  if(community.length<3||community.length>=5)return dr
  const sc={};all.forEach(c=>sc[c.suit]=(sc[c.suit]||0)+1)
  for(const s of SUITS){if(sc[s]===4&&hole.some(c=>c.suit===s)){dr.flushDraw=true;break}}
  const vals=[...new Set(all.map(cv))].sort((a,b)=>a-b);if(vals.includes(14))vals.unshift(1)
  for(let i=0;i<=vals.length-4;i++){const w=vals.slice(i,i+5);if(w.length>=4){const span=w[w.length-1]-w[0],uniq=new Set(w).size;if(uniq===4&&span<=4)dr.oesd=true;else if(uniq===4&&span<=4)dr.gutshot=true}}
  const cl=community.length===3?2:1
  if(dr.flushDraw&&dr.oesd)dr.equity=cl===2?0.54:0.32
  else if(dr.flushDraw)dr.equity=cl===2?0.35:0.19
  else if(dr.oesd)dr.equity=cl===2?0.31:0.17
  else if(dr.gutshot)dr.equity=cl===2?0.17:0.09
  return dr
}

function toIMPs(diff){
  const t=[[15,0],[45,1],[85,2],[125,3],[165,4],[215,5],[265,6],[315,7],[365,8],[425,9],[495,10],[595,11],[745,12],[895,13],[1095,14],[1295,15],[1495,16],[1745,17],[1995,18],[2245,19],[2495,20],[2995,21],[3495,22],[3995,23],[Infinity,24]]
  const a=Math.abs(diff);for(const[th,imp] of t)if(a<th)return diff>=0?imp:-imp;return diff>=0?24:-24
}

// BOTS at each table (skill 0-1: 0=fish, 1=pro)
// Mix: 1 fish, 1 weak rec, 1 average, 1 good reg, 1 tough
const BOTS=[
  {name:"Old Ray",style:"Fish",desc:"Calls everything, never bluffs.",agg:0.15,tight:0.15,bluff:0.02,skill:0.20},
  {name:"Dex",style:"Loose Aggro",desc:"Overplays hands, too many bluffs.",agg:0.85,tight:0.25,bluff:0.30,skill:0.35},
  {name:"Nina",style:"Average",desc:"Decent but predictable.",agg:0.45,tight:0.50,bluff:0.12,skill:0.50},
  {name:"Marta",style:"Solid Reg",desc:"Balanced, tough to exploit.",agg:0.60,tight:0.60,bluff:0.15,skill:0.75},
  {name:"Vic",style:"Shark",desc:"Reads situations, well-timed moves.",agg:0.55,tight:0.65,bluff:0.18,skill:0.90},
]
// AI comparison profiles (same skill spread for fair scoring)
const AI_PROFILES=[
  {name:"Fish Frank",agg:0.20,tight:0.20,bluff:0.03,skill:0.20},
  {name:"Loose Larry",agg:0.80,tight:0.30,bluff:0.28,skill:0.35},
  {name:"Average Amy",agg:0.50,tight:0.45,bluff:0.12,skill:0.50},
  {name:"Reg Rick",agg:0.58,tight:0.58,bluff:0.16,skill:0.75},
  {name:"Sharp Sara",agg:0.55,tight:0.62,bluff:0.18,skill:0.90},
]

function preflopStr(hole){
  const v1=cv(hole[0]),v2=cv(hole[1]),hi=Math.max(v1,v2),lo=Math.min(v1,v2)
  const paired=v1===v2,suited=hole[0].suit===hole[1].suit,gap=hi-lo
  if(paired){if(hi>=13)return 10;if(hi>=12)return 9;if(hi>=11)return 8;if(hi>=9)return 7;if(hi>=7)return 5;return 4}
  if(hi===14){if(lo>=12)return suited?9:8;if(lo>=11)return suited?8:7;if(lo>=10)return suited?7:6;return suited?5:3}
  if(hi>=12&&lo>=11)return suited?7:6;if(suited&&gap<=2&&hi>=8)return 5;if(suited&&gap<=1&&hi>=6)return 4
  if(hi>=12&&lo>=9)return 5;if(suited&&gap<=3&&hi>=7)return 3;if(hi>=10&&lo>=9)return 3;return suited?2:1
}

function aiDecide(hole,community,pot,toCall,chips,posFromBtn,stage,r,prof){
  if(chips<=0)return toCall>0?{action:"fold"}:{action:"check"}
  const p=prof||{agg:0.5,tight:0.5,bluff:0.15,skill:0.5}
  const sk=p.skill||0.5

  // Skill-based mistakes: lower skill = more random errors
  const mistakeChance=(1-sk)*0.35
  if(r()<mistakeChance){
    const m=r()
    if(sk<0.3){
      // Fish mistakes: call too much, never fold
      if(toCall>0&&m<0.6)return{action:"call"}
      if(toCall===0&&m<0.3)return{action:"check"}
    }else if(sk<0.5){
      // Weak player: occasional bad calls, sometimes folds good hands
      if(toCall>0&&m<0.4)return{action:"call"}
      if(toCall>0&&m<0.55)return{action:"fold"}
    }else{
      // Decent player: rare sizing errors
      if(toCall===0&&m<0.3)return{action:"raise",amount:Math.min(Math.floor(pot*(0.2+r()*0.8)),chips)}
    }
  }

  const posBonus=posFromBtn<=1?1.5:posFromBtn<=2?0.5:posFromBtn<=3?-0.5:posFromBtn<=4?0:1.0
  // Skill affects hand reading accuracy: low skill sometimes misjudges strength
  const strengthNoise=sk>=0.7?0:(r()<(1-sk)*0.3?(r()<0.5?-1:1):0)

  if(stage==="preflop"){
    const ps=preflopStr(hole),threshold=3+p.tight*4,adjPS=ps+posBonus
    if(ps>=9){const sz=Math.min(Math.floor(toCall>0?toCall*(2.5+p.agg):BB*(3+p.agg*2)),chips);return{action:"raise",amount:Math.max(sz,toCall+BB)}}
    if(adjPS>=threshold+2){if(r()<0.6+p.agg*0.3){const sz=Math.min(Math.floor(toCall>0?toCall*2.5:BB*3),chips);return{action:"raise",amount:Math.max(sz,toCall+BB)}};return toCall>0?{action:"call"}:{action:"raise",amount:Math.min(BB*3,chips)}}
    if(adjPS>=threshold){if(toCall<=BB*3)return{action:"call"};return r()<0.3?{action:"call"}:{action:"fold"}}
    if(adjPS>=threshold-1){if(toCall<=BB)return{action:"call"};if(toCall===0)return{action:"check"};return{action:"fold"}}
    if(r()<p.bluff&&toCall<=BB*2)return toCall===0?{action:"check"}:r()<0.5?{action:"call"}:{action:"fold"}
    return toCall===0?{action:"check"}:{action:"fold"}
  }
  const rawStrength=evalHand(hole,community)[0]
  const strength=Math.max(0,Math.min(8,rawStrength+strengthNoise))
  const draws=detectDraws(hole,community),potOdds=toCall>0?toCall/(pot+toCall):0
  // Skill affects bet sizing quality: higher skill = closer to optimal
  const sizeMult=0.7+sk*0.6  // 0.84 for fish, 1.24 for shark
  if(strength>=6){if(toCall>0)return{action:"raise",amount:Math.min(Math.floor(pot*(0.7+p.agg*0.3)*sizeMult),chips)};if(r()<0.25&&sk>0.6)return{action:"check"};return{action:"raise",amount:Math.min(Math.floor(pot*(0.5+p.agg*0.3)*sizeMult),chips)}}
  if(strength>=4){if(toCall>0)return r()<p.agg?{action:"raise",amount:Math.min(Math.floor(pot*0.65*sizeMult),chips)}:{action:"call"};return{action:"raise",amount:Math.min(Math.floor(pot*(0.5+p.agg*0.25)*sizeMult),chips)}}
  if(strength>=3){if(toCall>pot)return r()<0.5+p.agg*0.3?{action:"call"}:{action:"fold"};if(toCall>0)return{action:"call"};return{action:"raise",amount:Math.min(Math.floor(pot*(0.4+p.agg*0.3)*sizeMult),chips)}}
  if(strength>=2){if(toCall>pot*0.75)return r()<0.5?{action:"call"}:{action:"fold"};if(toCall>0)return{action:"call"};return r()<p.agg*0.8?{action:"raise",amount:Math.min(Math.floor(pot*0.35*sizeMult),chips)}:{action:"check"}}
  if(strength>=1){if(draws.equity>potOdds&&draws.equity>0)return toCall>0?{action:"call"}:{action:"raise",amount:Math.min(Math.floor(pot*0.4*sizeMult),chips)};if(toCall>pot*0.5)return r()<0.3?{action:"call"}:{action:"fold"};if(toCall>0)return r()<0.6?{action:"call"}:{action:"fold"};return r()<p.agg*0.5?{action:"raise",amount:Math.min(Math.floor(pot*0.3*sizeMult),chips)}:{action:"check"}}
  if(draws.equity>potOdds&&draws.equity>0.1){if(r()<p.agg*0.7)return{action:"raise",amount:Math.min(Math.floor(pot*(0.5+p.agg*0.25)*sizeMult),chips)};return toCall>0?{action:"call"}:{action:"check"}}
  if(draws.equity>0&&toCall<=pot*0.25)return toCall>0?{action:"call"}:{action:"check"}
  if(toCall===0&&r()<p.bluff)return{action:"raise",amount:Math.min(Math.floor(pot*(0.4+r()*0.3)*sizeMult),chips)}
  return toCall===0?{action:"check"}:{action:"fold"}
}

function resolvePots(players,community){
  const active=players.filter(p=>!p.folded),totalPot=players.reduce((s,p)=>s+p.totalBet,0)
  if(active.length===0)return{winners:[],pots:[]}
  if(active.length===1){active[0].chips+=totalPot;return{winners:[{id:active[0].id,amount:totalPot}],pots:[]}}
  const betLevels=[...new Set(active.map(p=>p.totalBet))].sort((a,b)=>a-b)
  const allWithBets=players.filter(p=>p.totalBet>0);let prevLevel=0;const winMap={}
  for(const level of betLevels){
    const increment=level-prevLevel;if(increment<=0)continue
    let potAmount=0;for(const p of allWithBets)potAmount+=Math.min(Math.max(p.totalBet-prevLevel,0),increment)
    const eligible=active.filter(p=>p.totalBet>=level);if(eligible.length===0)continue
    let bestRank=[0];for(const e of eligible){const r=evalHand(e.holeCards,community);if(cmpR(r,bestRank)>0)bestRank=r}
    const winners=eligible.filter(e=>cmpR(evalHand(e.holeCards,community),bestRank)===0)
    const share=Math.floor(potAmount/winners.length),rem=potAmount-share*winners.length
    for(let i=0;i<winners.length;i++){const amt=share+(i===0?rem:0);winners[i].chips+=amt;winMap[winners[i].id]=(winMap[winners[i].id]||0)+amt}
    prevLevel=level
  }
  return{winners:Object.entries(winMap).map(([id,amount])=>({id:+id,amount})),pots:[]}
}

function runBettingRound(players,phase,dealerIdx,commCards,pot,r,getProf){
  let betToCall=phase==="preflop"?BB:0
  if(phase!=="preflop")players.forEach(p=>p.currentBet=0)
  let acted={},raises=0
  let cur=phase==="preflop"?(dealerIdx+3)%6:(dealerIdx+1)%6,safety=0
  while(safety<6&&(players[cur].folded||players[cur].chips<=0)){cur=(cur+1)%6;safety++}
  if(safety>=6)return{pot,done:true}
  let maxLoops=30
  while(maxLoops-->0){
    const p=players[cur]
    if(!p.folded&&p.chips>0){
      const toCall=Math.max(betToCall-p.currentBet,0)
      const comm=phase==="preflop"?[]:phase==="flop"?commCards.slice(0,3):phase==="turn"?commCards.slice(0,4):commCards.slice(0,5)
      const posFromBtn=((cur-dealerIdx)+6)%6
      let dec=aiDecide(p.holeCards,comm,pot,toCall,p.chips,posFromBtn,phase,r,getProf(cur))
      if(dec.action==="raise"&&raises>=MAX_RAISES)dec=toCall>0?{action:"call"}:{action:"check"}
      if(dec.action==="raise"){const minBet=betToCall+BB;let amt=Math.max(dec.amount||minBet,minBet);amt=Math.min(amt,p.chips+p.currentBet);if(amt<=betToCall)dec=toCall>0?{action:"call"}:{action:"check"};else dec.amount=amt}
      if(dec.action==="fold")p.folded=true
      else if(dec.action==="call"){const call=Math.min(toCall,p.chips);p.chips-=call;p.currentBet+=call;p.totalBet+=call;pot+=call}
      else if(dec.action==="raise"){const toAdd=dec.amount-p.currentBet;p.chips-=toAdd;p.currentBet=dec.amount;p.totalBet+=toAdd;pot+=toAdd;betToCall=dec.amount;raises++;acted={}}
      acted[cur]=true
    }
    if(players.filter(x=>!x.folded).length<=1)return{pot,done:true}
    if(players.every(x=>x.folded||x.chips===0||(acted[x.id]&&x.currentBet===betToCall)))return{pot,done:false}
    let next=(cur+1)%6,s2=0;while(s2<6&&(players[next].folded||players[next].chips<=0)){next=(next+1)%6;s2++}
    if(s2>=6)return{pot,done:true};cur=next
  }
  return{pot,done:true}
}

function simOrbit(orbitSeed,dealerStart,profileIdx){
  const profile=AI_PROFILES[profileIdx],masterRng=mkRng(orbitSeed+(profileIdx+1)*7919)
  let stacks=Array(6).fill(STARTING)
  for(let h=0;h<HANDS_PER_ORBIT;h++){
    const dealerIdx=(dealerStart+h)%6,handRng=mkRng(orbitSeed+h*997),d=shuf(mkDeck(),handRng),comm=d.slice(12,17)
    const players=stacks.map((chips,i)=>({id:i,holeCards:[d[i*2],d[i*2+1]],chips:Math.max(chips,0),folded:false,currentBet:0,totalBet:0}))
    if(players[0].chips<=0){stacks=players.map(p=>Math.max(p.chips,0));continue}
    let pot=0;for(const p of players){const ante=Math.min(ANTE,p.chips);p.chips-=ante;p.totalBet+=ante;pot+=ante}
    const sbIdx=(dealerIdx+1)%6,bbIdx=(dealerIdx+2)%6
    const sb=Math.min(SB,players[sbIdx].chips);players[sbIdx].chips-=sb;players[sbIdx].currentBet=sb;players[sbIdx].totalBet+=sb;pot+=sb
    const bb=Math.min(BB,players[bbIdx].chips);players[bbIdx].chips-=bb;players[bbIdx].currentBet=bb;players[bbIdx].totalBet+=bb;pot+=bb
    if(players.filter(p=>!p.folded&&p.chips>0).length<2){const a=players.filter(p=>!p.folded);if(a.length>0)a[0].chips+=pot;stacks=players.map(p=>Math.max(p.chips,0));continue}
    const getProf=(idx)=>{if(idx===0)return{agg:profile.agg,tight:profile.tight,bluff:profile.bluff};const bot=BOTS[idx-1];return bot?{agg:bot.agg,tight:bot.tight,bluff:bot.bluff}:null}
    for(const phase of["preflop","flop","turn","river"]){const result=runBettingRound(players,phase,dealerIdx,comm,pot,masterRng,getProf);pot=result.pot;if(result.done)break}
    const active=players.filter(p=>!p.folded)
    if(active.length===1)active[0].chips+=pot;else if(active.length>1)resolvePots(players,comm.slice(0,5))
    stacks=players.map(p=>Math.max(p.chips,0))
  }
  return stacks[0]-STARTING
}

// ═══════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════
const F = "'Palatino Linotype', 'Book Antiqua', Palatino, serif"
const POSITIONS=[
  {top:"80%",left:"50%",tx:"-50%",ty:"-50%"},{top:"65%",left:"8%",tx:"-50%",ty:"-50%"},
  {top:"25%",left:"8%",tx:"-50%",ty:"-50%"},{top:"8%",left:"50%",tx:"-50%",ty:"-50%"},
  {top:"25%",left:"92%",tx:"-50%",ty:"-50%"},{top:"65%",left:"92%",tx:"-50%",ty:"-50%"},
]

function Card({card,faceDown,small,highlight}){
  const sz=small?{w:40,h:58,f:"11px",sf:"14px"}:{w:54,h:78,f:"14px",sf:"20px"}
  if(faceDown)return <div style={{width:sz.w,height:sz.h,borderRadius:6,border:"2px solid #2c3e50",background:"repeating-linear-gradient(135deg,#1a3a4a,#1a3a4a 4px,#0d2133 4px,#0d2133 8px)",boxShadow:"0 2px 6px rgba(0,0,0,0.3)",display:"inline-block",margin:1.5}}/>
  return <div style={{width:sz.w,height:sz.h,borderRadius:6,border:highlight?"2px solid #f1c40f":"2px solid #bdc3c7",background:highlight?"linear-gradient(135deg,#fffef0,#fff9db)":"linear-gradient(135deg,#fff,#f8f9fa)",boxShadow:highlight?"0 0 8px rgba(241,196,15,0.4)":"0 2px 5px rgba(0,0,0,0.15)",display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",margin:1.5,fontFamily:"monospace",userSelect:"none"}}>
    <div style={{color:SC[card.suit],fontSize:sz.f,fontWeight:700,lineHeight:1}}>{RD[card.rank]||card.rank}</div>
    <div style={{color:SC[card.suit],fontSize:sz.sf,lineHeight:1,marginTop:1}}>{card.suit}</div>
  </div>
}

function Seat({player,isActive,position,showCards,dealerIndex}){
  const pos=POSITIONS[position],isD=position===dealerIndex,isSB=position===(dealerIndex+1)%6,isBB=position===(dealerIndex+2)%6
  const folded=player.folded
  const bc=folded?"rgba(231,76,60,0.25)":isActive?"#f1c40f":"rgba(255,255,255,0.15)"
  return <div style={{position:"absolute",top:pos.top,left:pos.left,transform:`translate(${pos.tx},${pos.ty})`,zIndex:isActive?10:5,textAlign:"center",minWidth:90}}>
    <div style={{background:folded?"rgba(15,15,20,0.85)":isActive?"rgba(241,196,15,0.12)":"rgba(30,30,50,0.85)",border:`2px solid ${bc}`,borderRadius:9,padding:"5px 9px",opacity:folded?0.35:1,transition:"all 0.3s",position:"relative"}}>
      {folded&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",color:"#e74c3c",fontSize:11,fontWeight:800,letterSpacing:2,textTransform:"uppercase",zIndex:2,textShadow:"0 0 6px rgba(0,0,0,0.8)"}}>FOLD</div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3,marginBottom:2}}>
        <span style={{fontSize:11,fontWeight:700,color:player.isHuman?"#f1c40f":"#ccc"}}>{player.name}</span>
        {isD&&<span style={{fontSize:8,background:"#f1c40f",color:"#000",borderRadius:7,padding:"0 3px",fontWeight:800}}>D</span>}
        {isSB&&<span style={{fontSize:7,color:"#888"}}>SB</span>}
        {isBB&&<span style={{fontSize:7,color:"#888"}}>BB</span>}
      </div>
      {!player.isHuman&&player.style&&<div style={{fontSize:8,color:"#666",marginBottom:1}}>{player.style}</div>}
      <div style={{fontSize:12,fontWeight:600,color:player.chips>STARTING?"#2ecc71":player.chips<STARTING?"#e7a33c":"#ddd"}}>${player.chips}</div>
      {player.currentBet>0&&<div style={{fontSize:15,color:"#f39c12",fontWeight:800,marginTop:1}}>⬆ ${player.currentBet}</div>}
    </div>
    <div style={{display:"flex",justifyContent:"center",marginTop:3,minHeight:32}}>
      {player.isHuman&&player.holeCards.length===2&&!folded&&player.holeCards.map((c,i)=><Card key={i} card={c} small highlight/>)}
      {!player.isHuman&&player.holeCards.length===2&&!folded&&(showCards?player.holeCards.map((c,i)=><Card key={i} card={c} small/>):[0,1].map(i=><Card key={i} faceDown small/>))}
    </div>
  </div>
}

function BetControls({phase,pot,betToCall,playerBet,playerChips,raises,onAction}){
  const[sv,setSv]=useState(0)
  const[typedBet,setTypedBet]=useState("")
  const toCall=Math.max(betToCall-playerBet,0),canRaise=raises<MAX_RAISES&&playerChips>toCall
  const minR=betToCall+BB,maxR=playerChips+playerBet
  useEffect(()=>{setSv(minR);setTypedBet("")},[minR,phase])
  const btn=(l,a,am,bg,dis)=><button disabled={dis} onClick={()=>onAction(a,am)} style={{background:dis?"#333":bg,color:dis?"#666":"#fff",border:"none",borderRadius:8,padding:"10px 16px",fontSize:13,fontWeight:700,cursor:dis?"default":"pointer",fontFamily:F,opacity:dis?0.5:1,minWidth:80}}>{l}</button>
  const presets=phase==="preflop"?[{l:"2x",v:BB*2},{l:"3x",v:BB*3},{l:"5x",v:BB*5},{l:"8x",v:BB*8}]:[{l:"33%",v:Math.floor(pot*0.33)},{l:"50%",v:Math.floor(pot*0.5)},{l:"75%",v:Math.floor(pot*0.75)},{l:"Pot",v:pot}]
  const submitTypedBet=()=>{const n=parseInt(typedBet);if(!isNaN(n)&&n>=minR&&n<=maxR){onAction("raise",n)}else if(!isNaN(n)&&n>maxR){onAction("raise",maxR)}else{setTypedBet("")}}
  return <div style={{width:"100%",maxWidth:660,padding:"8px",display:"flex",flexDirection:"column",gap:10,alignItems:"center"}}>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
      {toCall===0?btn("Check","check",0,"#2c3e50"):btn(`Call $${toCall}`,"call",0,"#27ae60")}
      {btn("Fold","fold",0,"#7f1d1d")}
      {canRaise&&btn(`All-In $${playerChips}`,"raise",maxR,"#8e44ad")}
    </div>
    {canRaise&&<>
      <div style={{width:"100%",height:1,background:"rgba(255,255,255,0.06)",margin:"2px 0"}}/>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>
        {presets.map(({l,v})=>{const rAmt=Math.max(Math.min(v,maxR),minR);return <button key={l} onClick={()=>{setSv(rAmt);onAction("raise",rAmt)}} style={{background:"rgba(255,255,255,0.08)",color:"#ccc",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:F}}>{l} (${rAmt})</button>})}
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",maxWidth:400}}>
        <span style={{fontSize:10,color:"#888"}}>${minR}</span>
        <input type="range" min={minR} max={maxR} step={BB} value={sv} onChange={e=>setSv(+e.target.value)} style={{flex:1,accentColor:"#f1c40f"}}/>
        <span style={{fontSize:10,color:"#888"}}>${maxR}</span>
        <button onClick={()=>onAction("raise",sv)} style={{background:"linear-gradient(135deg,#e67e22,#d35400)",color:"white",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:F}}>Raise ${sv}</button>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:10,color:"#888"}}>$</span>
        <input type="number" placeholder={`${minR}-${maxR}`} value={typedBet} onChange={e=>setTypedBet(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submitTypedBet()} style={{width:90,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"5px 8px",fontSize:13,color:"#e0e0e0",fontFamily:F,textAlign:"center",outline:"none"}}/>
        <button onClick={submitTypedBet} disabled={!typedBet} style={{background:typedBet?"linear-gradient(135deg,#e67e22,#d35400)":"#333",color:typedBet?"white":"#666",border:"none",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:typedBet?"pointer":"default",fontFamily:F}}>Bet</button>
      </div>
    </>}
  </div>
}

// ═══════════════════════════════════════════════
// LOBBY
// ═══════════════════════════════════════════════
function Lobby({onJoined,onViewResults}){
  const[mode,setMode]=useState(null)
  const[name,setName]=useState("")
  const[code,setCode]=useState("")
  const[orbits,setOrbits]=useState(DEFAULT_ORBITS)
  const[status,setStatus]=useState("")
  const[loading,setLoading]=useState(false)
  const[profile,setProfile]=useState(null)
  const[recentGames,setRecentGames]=useState([])
  const[gamesLoading,setGamesLoading]=useState(true)

  // Look up player profile when name changes
  useEffect(()=>{
    if(!name.trim()||name.trim().length<2){setProfile(null);return}
    const t=setTimeout(async()=>{
      const p=await DB.getProfile(name.trim())
      setProfile(p)
    },400)
    return ()=>clearTimeout(t)
  },[name])

  // Load recent games
  useEffect(()=>{
    async function loadGames(){
      try{
        const idx=await DB.getRoomIndex()
        if(!idx||!Array.isArray(idx)){setGamesLoading(false);return}
        const enriched=[]
        for(const g of idx.slice(0,12)){
          try{
            const room=await DB.getRoom(g.code)
            if(!room||!room.players)continue
            let allDone=true,anyStarted=false
            const playerStatus=[]
            for(const p of room.players){
              const results=await DB.getAllResults(g.code,p.num,room.orbits)
              const completed=results.filter(r=>r!==null).length
              const done=completed>=room.orbits
              if(!done)allDone=false
              if(completed>0)anyStarted=true
              playerStatus.push({...p,completed,done})
            }
            enriched.push({...g,players:room.players.map(p=>p.name),playerStatus,orbits:room.orbits,allDone,anyStarted,playerCount:room.players.length})
          }catch(e){continue}
        }
        setRecentGames(enriched)
      }catch(e){console.error("Load games error:",e)}
      setGamesLoading(false)
    }
    loadGames()
  },[])

  const createRoom=async()=>{
    if(!name.trim())return setStatus("Enter your name")
    setLoading(true)
    try{
      const rc=Math.random().toString(36).substring(2,6).toUpperCase()
      const seeds=Array.from({length:orbits},()=>Math.floor(Math.random()*2000000000))
      await DB.createRoom(rc,seeds[0],orbits,seeds,name.trim())
      setLoading(false)
      onJoined({code:rc,seeds,orbits,playerNum:1,myName:name.trim(),totalPlayers:1})
    }catch(e){setLoading(false);setStatus("Error starting game: "+e.message)}
  }

  const joinRoom=async()=>{
    if(!name.trim())return setStatus("Enter your name")
    if(!code.trim()||code.trim().length!==4)return setStatus("Enter 4-letter game code")
    setLoading(true)
    try{
      const rc=code.trim().toUpperCase()
      const room=await DB.getRoom(rc)
      if(!room){setLoading(false);return setStatus("Game not found")}
      let viewed=false;try{viewed=await DB.hasViewedResults(rc,name.trim())}catch(e){}
      if(viewed){setLoading(false);return setStatus("You've already viewed results for this game — can't join")}
      if(room.players.length>=10&&!room.players.some(p=>p.name===name.trim())){setLoading(false);return setStatus("Game is full (max 10)")}
      if(!room.players.some(p=>p.name===name.trim())){await DB.joinRoom(rc,name.trim())}
      const updatedRoom=await DB.getRoom(rc)
      const me=updatedRoom.players.find(p=>p.name===name.trim())
      const playerNum=me?me.num:(updatedRoom.players.length)
      setLoading(false)
      onJoined({code:rc,seeds:updatedRoom.seeds,orbits:updatedRoom.orbits,playerNum,myName:name.trim(),totalPlayers:updatedRoom.players.length},true)
    }catch(e){setLoading(false);setStatus("Error: "+e.message)}
  }

  const joinGameFromList=async(g)=>{
    if(!name.trim())return setStatus("Enter your name first")
    let viewed=false;try{viewed=await DB.hasViewedResults(g.code,name.trim())}catch(e){}
    if(viewed)return setStatus("You've already viewed results for game "+g.code)
    try{
      const rc=g.code
      const room=await DB.getRoom(rc)
      if(!room)return setStatus("Game not found")
      if(room.players.length>=10&&!room.players.some(p=>p.name===name.trim()))return setStatus("Game full")
      if(!room.players.some(p=>p.name===name.trim())){await DB.joinRoom(rc,name.trim())}
      const updatedRoom=await DB.getRoom(rc)
      const me=updatedRoom.players.find(p=>p.name===name.trim())
      onJoined({code:rc,seeds:updatedRoom.seeds,orbits:updatedRoom.orbits,playerNum:me?me.num:updatedRoom.players.length,myName:name.trim(),totalPlayers:updatedRoom.players.length},true)
    }catch(e){setStatus("Error: "+e.message)}
  }

  const I={background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"10px 14px",fontSize:15,color:"#e0e0e0",fontFamily:F,width:"100%",boxSizing:"border-box",outline:"none"}
  const B=(bg)=>({background:bg,color:"#fff",border:"none",borderRadius:10,padding:"12px 28px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:F,width:"100%",opacity:loading?0.5:1})

  return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,fontFamily:F,color:"#e0e0e0"}}>
    <div style={{maxWidth:420,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:16,padding:32,border:"1px solid rgba(255,255,255,0.08)"}}>
      <h1 style={{textAlign:"center",fontSize:28,color:"#f1c40f",marginBottom:4}}>Duplicate Poker</h1>
      <div style={{textAlign:"center",color:"#888",fontSize:13,marginBottom:4}}>Same Cards · Different Decisions · Who Plays Better?</div>
      <div style={{textAlign:"center",marginBottom:20}}><button onClick={()=>setMode("rules")} style={{background:"none",border:"1px solid rgba(255,255,255,0.15)",borderRadius:20,padding:"4px 14px",fontSize:11,color:"#888",cursor:"pointer",fontFamily:F}}>📖 How It Works</button></div>

      {!mode&&<>
        <div style={{marginBottom:12}}><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} style={I}/></div>
        {profile&&<div style={{marginBottom:14,padding:12,background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{color:"#aaa",fontSize:12}}>Welcome back, {profile.name}</span>
            {profile.history.length>0&&<span style={{fontSize:10,color:tierInfo(calcWeightedRating(profile.history)).color,fontWeight:600}}>{tierInfo(calcWeightedRating(profile.history)).icon} {tierInfo(calcWeightedRating(profile.history)).name}</span>}
          </div>
          <div style={{display:"flex",justifyContent:"space-around",textAlign:"center"}}>
            <div><div style={{fontSize:22,fontWeight:800,color:profile.history.length>0?tierInfo(calcWeightedRating(profile.history)).color:"#888"}}>{profile.history.length>0?calcWeightedRating(profile.history):"—"}</div><div style={{fontSize:9,color:"#666"}}>Rating</div></div>
            <div><div style={{fontSize:16,fontWeight:700,color:"#aaa"}}>{profile.sessions}</div><div style={{fontSize:9,color:"#666"}}>Sessions</div></div>
            <div><div style={{fontSize:16,fontWeight:700,color:profile.totalMaxMP>0&&(profile.totalMP/profile.totalMaxMP*100)>=50?"#2ecc71":"#e74c3c"}}>{profile.totalMaxMP>0?(profile.totalMP/profile.totalMaxMP*100).toFixed(1):"—"}%</div><div style={{fontSize:9,color:"#666"}}>Career MP</div></div>
            <div><div style={{fontSize:16,fontWeight:700,color:"#f1c40f"}}>{profile.bestPct>0?profile.bestPct.toFixed(1):"—"}%</div><div style={{fontSize:9,color:"#666"}}>Best</div></div>
          </div>
        </div>}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
          <button onClick={()=>{if(!name.trim())return setStatus("Enter your name");setMode("create")}} style={B("linear-gradient(135deg,#27ae60,#1e8449)")}>Start Game</button>
          <button onClick={()=>{if(!name.trim())return setStatus("Enter your name");setMode("join")}} style={B("linear-gradient(135deg,#2980b9,#1a5276)")}>Join Game</button>
          <button onClick={()=>onViewResults(null,null)} style={B("linear-gradient(135deg,#2c3e50,#1a252f)")}>Player Lookup</button>
          <button onClick={()=>onViewResults("__rankings__",null)} style={B("linear-gradient(135deg,#8e44ad,#6c3483)")}>🏆 Rankings</button>
        </div>

        {/* Recent & Ongoing Games */}
        {recentGames.length>0&&<div style={{marginTop:8}}>
          <div style={{color:"#888",fontSize:12,fontWeight:600,marginBottom:6}}>Recent Games</div>
          {recentGames.map((g,i)=>{
            const isIn=name.trim()&&g.players.includes(name.trim())
            const statusLabel=g.allDone?"✓ Complete":g.anyStarted?"⏳ In Progress":"Waiting"
            const statusColor=g.allDone?"#2ecc71":g.anyStarted?"#f1c40f":"#888"
            const age=Date.now()-(g.created||0)
            const ageStr=age<3600000?Math.floor(age/60000)+"m ago":age<86400000?Math.floor(age/3600000)+"h ago":Math.floor(age/86400000)+"d ago"
            // Anyone can still play a room if they haven't already played it
            const canPlay=name.trim()&&!isIn
            const tapAction=canPlay?"tap to play →":isIn?"tap for results →":g.allDone?"tap for results →":"tap to join →"
            return <div key={i} style={{padding:10,marginBottom:4,background:isIn?"rgba(46,204,113,0.05)":"rgba(255,255,255,0.02)",borderRadius:8,border:`1px solid ${isIn?"rgba(46,204,113,0.15)":"rgba(255,255,255,0.06)"}`,cursor:"pointer"}}
              onClick={()=>{
                if(!name.trim()){onViewResults(g.code,null);return}
                if(isIn){onViewResults(g.code,null);return}
                // Not in game yet — join it (even if "complete", others can still play)
                joinGameFromList(g)
              }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <span style={{fontSize:14,fontWeight:700,color:"#f1c40f",marginRight:8}}>{g.code}</span>
                  <span style={{fontSize:10,color:statusColor,fontWeight:600}}>{statusLabel}</span>
                </div>
                <div style={{fontSize:9,color:"#555"}}>{ageStr}</div>
              </div>
              <div style={{fontSize:11,color:"#aaa",marginTop:3}}>{g.players.join(", ")}</div>
              <div style={{fontSize:9,color:"#555",marginTop:2}}>{g.orbits} orbits · {g.playerCount} player{g.playerCount!==1?"s":""}{isIn?" · 👤 You're in":""}</div>
              <div style={{fontSize:9,color:canPlay?"#2ecc71":"#555",textAlign:"right"}}>{tapAction}</div>
            </div>
          })}
        </div>}
        {gamesLoading&&<div style={{textAlign:"center",color:"#555",fontSize:11,padding:8}}>Loading games...</div>}
      </>}

      {mode==="create"&&<>
        <div style={{marginBottom:14}}>
          <div style={{color:"#aaa",fontSize:12,marginBottom:6}}>Number of orbits ({HANDS_PER_ORBIT} hands each)</div>
          <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
            {[2,3,4,5,6,8,10,12].map(n=><button key={n} onClick={()=>setOrbits(n)} style={{background:orbits===n?"rgba(241,196,15,0.2)":"rgba(255,255,255,0.06)",border:orbits===n?"1px solid #f1c40f":"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"6px 10px",fontSize:13,fontWeight:orbits===n?700:400,color:orbits===n?"#f1c40f":"#aaa",cursor:"pointer",fontFamily:F,minWidth:36}}>{n}</button>)}
          </div>
          <div style={{textAlign:"center",color:"#666",fontSize:11,marginTop:4}}>{orbits*HANDS_PER_ORBIT} hands · ~{Math.round(orbits*HANDS_PER_ORBIT*2.5)} min</div>
        </div>
        <button onClick={createRoom} disabled={loading} style={B("linear-gradient(135deg,#27ae60,#1e8449)")}>{loading?"Starting...":"Start Game"}</button>
      </>}

      {mode==="join"&&<>
        <div style={{marginBottom:12}}><input placeholder="Game code (4 letters)" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={4} style={{...I,textAlign:"center",fontSize:24,letterSpacing:8}}/></div>
        <button onClick={joinRoom} disabled={loading} style={B("linear-gradient(135deg,#2980b9,#1a5276)")}>{loading?"Joining...":"Join Game"}</button>
      </>}

      {mode==="rules"&&<div style={{lineHeight:1.7,fontSize:13,color:"#ccc"}}>
        <h3 style={{color:"#f1c40f",fontSize:16,marginBottom:8,textAlign:"center"}}>How Duplicate Poker Works</h3>
        <p style={{marginBottom:10}}>This is <strong style={{color:"#e0e0e0"}}>Texas Hold'em poker</strong>, with the luck of the cards removed — your success is only compared to other players who held the <strong style={{color:"#f1c40f"}}>exact same cards</strong>.</p>
        <p style={{marginBottom:10,color:"#aaa",fontSize:12}}><strong style={{color:"#e0e0e0"}}>The Setup:</strong> Each table has 5 AI bots and one human. Every human in the room plays at their own table, but all tables are dealt the same cards from the same deck. At the start of each orbit, everyone begins with {STARTING} chips. Small blind is {SB}, big blind is {BB}, and there is a {ANTE} ante.</p>
        <p style={{marginBottom:10,color:"#aaa",fontSize:12}}><strong style={{color:"#e0e0e0"}}>Scoring:</strong> After the orbit ({HANDS_PER_ORBIT} hands), compare the chip count of all players who sat in the same seat. The one with the fewest chips gets 0 matchpoints, 2nd fewest gets 1 matchpoint, all the way up to the person with the most chips getting N−1 matchpoints (where N is the number of tables in play). Additional tables of AI bots are used to fill in the field.</p>
        <p style={{marginBottom:10,color:"#aaa",fontSize:12}}><strong style={{color:"#e0e0e0"}}>Orbits:</strong> When you move to the next orbit, everyone's chip stack resets to {STARTING}. A game lasts several orbits — you select the number when you create a room. The player with the most matchpoints wins.</p>
        <p style={{marginBottom:10,color:"#aaa",fontSize:12}}><strong style={{color:"#e0e0e0"}}>Rating:</strong> Your career rating is your weighted matchpoint percentage across all sessions. Recent sessions count double. A rating of 57 means you outplay the field 57% of the time.</p>
        <p style={{marginBottom:10,color:"#aaa",fontSize:12}}><strong style={{color:"#e0e0e0"}}>Async play:</strong> You don't need to be online at the same time. Create a room, share the code, and play on your own schedule. Players can still join completed games as long as they haven't already played that room.</p>
        <p style={{color:"#888",fontSize:11,fontStyle:"italic"}}>No gambling — this is a pure skill competition. The cards are the same; only your decisions matter.</p>
      </div>}

      {mode&&<button onClick={()=>setMode(null)} style={{background:"none",border:"none",color:"#666",fontSize:12,cursor:"pointer",fontFamily:F,marginTop:8,width:"100%",textAlign:"center"}}>← Back</button>}
      {status&&<div style={{marginTop:10,textAlign:"center",fontSize:12,color:status.includes("rror")||status.includes("not")||status.includes("full")||status.includes("already")?"#e74c3c":"#888"}}>{status}</div>}

      <div style={{marginTop:20,padding:12,background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid rgba(255,255,255,0.05)"}}>
        <div style={{fontSize:11,color:"#666",lineHeight:1.6}}>
          Play at your own pace — no need to be online at the same time.
          Everyone gets the same cards in the same seat. Share the room code
          and compare results whenever you're done.
        </div>
      </div>
    </div>
  </div>
}

// ═══════════════════════════════════════════════
// ROOM CODE DISPLAY (after creating)
// ═══════════════════════════════════════════════
function ShareCode({code,orbits,onStart}){
  const[copied,setCopied]=useState(false)
  const copy=()=>{navigator.clipboard?.writeText(code).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000)})}
  return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,fontFamily:F,color:"#e0e0e0"}}>
    <div style={{maxWidth:420,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:16,padding:32,border:"1px solid rgba(255,255,255,0.08)",textAlign:"center"}}>
      <div style={{color:"#888",fontSize:13,marginBottom:8}}>Share this code with your opponents</div>
      <div style={{fontSize:52,letterSpacing:14,color:"#f1c40f",fontWeight:800,marginBottom:8,cursor:"pointer"}} onClick={copy}>{code}</div>
      <div style={{color:copied?"#2ecc71":"#666",fontSize:12,marginBottom:20}}>{copied?"Copied!":"Tap code to copy"}</div>
      <div style={{color:"#888",fontSize:12,marginBottom:20}}>{orbits} orbits · {orbits*HANDS_PER_ORBIT} hands</div>
      <div style={{color:"#aaa",fontSize:12,marginBottom:20,lineHeight:1.6}}>
        They can join anytime — you don't need to play at the same time.
        When you're both done, either of you can view the head-to-head results.
      </div>
      <button onClick={onStart} style={{background:"linear-gradient(135deg,#27ae60,#1e8449)",color:"white",border:"none",borderRadius:12,padding:"14px 40px",fontSize:17,fontWeight:700,cursor:"pointer",fontFamily:F,boxShadow:"0 4px 15px rgba(39,174,96,0.3)"}}>Start Playing</button>
    </div>
  </div>
}

// ═══════════════════════════════════════════════
// ORBIT SCORECARD (solo — no opponent data needed)
// ═══════════════════════════════════════════════
function OrbitScore({orbit,sessionMP,sessionMaxMP,sessionIMPs,orbitNum,totalOrbits,onNext}){
  const[humanResults,setHumanResults]=useState([])
  const[humanCount,setHumanCount]=useState(0)

  // Check for other human results
  useEffect(()=>{
    async function fetchHumans(){
      if(!orbit.roomCode||!orbit.playerNum)return
      const room=await DB.getRoom(orbit.roomCode)
      if(!room)return
      setHumanCount(room.players.length)
      const others=[]
      for(const p of room.players){
        if(p.num===orbit.playerNum)continue
        const r=await DB.getOrbitResult(orbit.roomCode,p.num,orbitNum)
        if(r)others.push({name:p.name,pnl:r.pnl,isHuman:true})
      }
      setHumanResults(others)
    }
    fetchHumans()
  },[orbit.roomCode,orbit.playerNum,orbitNum])

  const allResults=[...humanResults,...orbit.aiResults]
  const sorted=[...allResults].sort((a,b)=>b.pnl-a.pnl)
  let mp=0;for(const c of allResults){if(orbit.humanPnL>c.pnl)mp+=1;else if(orbit.humanPnL===c.pnl)mp+=0.5}
  const maxMp=allResults.length
  const mpPct=maxMp>0?((mp/maxMp)*100).toFixed(1):"—"
  const medArr=[...allResults.map(c=>c.pnl)].sort((a,b)=>a-b)
  const median=medArr.length>0?medArr[Math.floor(medArr.length/2)]:0
  const imps=toIMPs(orbit.humanPnL-median)
  const newSMP=sessionMP+mp,newSMax=sessionMaxMP+maxMp,newSIMPs=sessionIMPs+imps
  const sPct=newSMax>0?((newSMP/newSMax)*100).toFixed(1):"—"

  return <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",fontFamily:F,color:"#e0e0e0",overflowY:"auto"}}>
    <div style={{maxWidth:600,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:24,border:"1px solid rgba(255,255,255,0.08)",margin:"20px 0"}}>
      <h2 style={{textAlign:"center",color:"#f1c40f",fontSize:20,marginBottom:14}}>Orbit {orbitNum}/{totalOrbits} — Scorecard</h2>

      <div style={{marginBottom:14}}>
        <div style={{color:"#888",fontSize:11,marginBottom:4}}>Hand-by-Hand</div>
        {orbit.handLog.map((h,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 6px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{color:"#666",fontSize:10,width:18}}>{h.handInOrbit}</span>
            {h.humanCards.map((c,j)=><span key={j} style={{color:SC[c.suit],fontSize:11,fontFamily:"monospace"}}>{cd(c)}</span>)}
            <span style={{color:"#555",fontSize:9}}>{h.humanFolded?"fold":h.humanHandName}</span>
          </div>
          <span style={{fontSize:12,fontWeight:600,color:h.humanResult>=0?"#2ecc71":"#e74c3c"}}>{h.humanResult>=0?"+":""}{h.humanResult}</span>
        </div>)}
      </div>

      <div style={{textAlign:"center",padding:10,marginBottom:14,borderTop:"1px solid rgba(255,255,255,0.06)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <span style={{color:"#aaa",fontSize:12}}>Orbit P&L: </span>
        <span style={{fontSize:24,fontWeight:700,color:orbit.humanPnL>=0?"#2ecc71":"#e74c3c"}}>{orbit.humanPnL>=0?"+":""}{orbit.humanPnL}</span>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{color:"#888",fontSize:11,marginBottom:4,textAlign:"center"}}>
          vs {NUM_AI} AI{humanResults.length>0?` + ${humanResults.length} human${humanResults.length>1?"s":""}`:""} · {humanCount>1?`${humanCount} players in room`:""}
        </div>
        {sorted.map((c,i)=>{
          const beat=orbit.humanPnL>c.pnl,tied=orbit.humanPnL===c.pnl
          return (
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 9px",marginBottom:2,background:beat?"rgba(46,204,113,0.06)":tied?"rgba(241,196,15,0.06)":"rgba(231,76,60,0.06)",borderRadius:5,borderLeft:`3px solid ${beat?"#2ecc71":tied?"#f1c40f":"#e74c3c"}`}}>
              <span style={{fontSize:12,color:c.isHuman?"#3498db":"#ccc",fontWeight:c.isHuman?700:600}}>{c.name}{c.isHuman?" 👤":""}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,fontWeight:600,color:c.pnl>=0?"#2ecc71":"#e74c3c"}}>{c.pnl>=0?"+":""}{c.pnl}</span>
                <span style={{fontSize:11,fontWeight:700,color:beat?"#2ecc71":tied?"#f1c40f":"#e74c3c"}}>{beat?"✓":tied?"½":"✗"}</span>
              </div>
            </div>
          )
        })}      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div style={{textAlign:"center",padding:12,borderRadius:9,background:mp>=3?"rgba(46,204,113,0.12)":"rgba(231,76,60,0.12)"}}>
          <div style={{color:"#aaa",fontSize:10}}>AI Matchpoints</div>
          <div style={{fontSize:22,fontWeight:700,color:mp>=3?"#2ecc71":"#e74c3c"}}>{mp}/{maxMp}</div>
          <div style={{color:"#888",fontSize:11}}>{mpPct}%</div>
        </div>
        <div style={{textAlign:"center",padding:12,borderRadius:9,background:imps>0?"rgba(52,152,219,0.12)":"rgba(231,76,60,0.12)"}}>
          <div style={{color:"#aaa",fontSize:10}}>IMPs vs Median</div>
          <div style={{fontSize:22,fontWeight:700,color:imps>0?"#3498db":imps<0?"#e74c3c":"#888"}}>{imps>0?"+":""}{imps}</div>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:12,padding:"6px 0",background:"rgba(255,255,255,0.03)",borderRadius:7}}>
        <div style={{textAlign:"center"}}><div style={{color:"#888",fontSize:10}}>Session MP%</div><div style={{fontSize:16,fontWeight:700,color:sPct>=55?"#2ecc71":sPct>=45?"#f1c40f":"#e74c3c"}}>{sPct}%</div></div>
        <div style={{textAlign:"center"}}><div style={{color:"#888",fontSize:10}}>Session IMPs</div><div style={{fontSize:16,fontWeight:700,color:newSIMPs>0?"#3498db":"#e74c3c"}}>{newSIMPs>0?"+":""}{newSIMPs}</div></div>
        <div style={{textAlign:"center"}}><div style={{color:"#888",fontSize:10}}>Orbits</div><div style={{fontSize:16,fontWeight:700,color:"#f1c40f"}}>{orbitNum}/{totalOrbits}</div></div>
      </div>

      <div style={{textAlign:"center"}}><button onClick={()=>onNext(mp,maxMp,imps)} style={{background:"linear-gradient(135deg,#27ae60,#1e8449)",color:"white",border:"none",borderRadius:9,padding:"10px 24px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:F}}>
        {orbitNum>=totalOrbits?"View Session Results →":"Next Orbit →"}
      </button></div>
    </div>
  </div>
}

// ═══════════════════════════════════════════════
// SESSION RESULTS (with optional opponent comparison)
// ═══════════════════════════════════════════════
function SessionResults({orbits,totalMP,maxMP,totalIMPs,myName,roomCode,playerNum,totalOrbits,seeds,onNew}){
  const[others,setOthers]=useState([])
  const[checking,setChecking]=useState(false)
  const[checked,setChecked]=useState(false)
  const[playerCount,setPlayerCount]=useState(1)
  const[ratingInfo,setRatingInfo]=useState(null)
  const pct=maxMP>0?(totalMP/maxMP*100).toFixed(1):"0.0"
  const grade=pct>=65?"A+":pct>=60?"A":pct>=55?"B+":pct>=50?"B":pct>=45?"C":pct>=40?"D":"F"
  const gc=pct>=55?"#2ecc71":pct>=45?"#f1c40f":"#e74c3c"

  // Update rating on mount (once)
  const ratingDone=useRef(false)
  useEffect(()=>{
    if(ratingDone.current)return
    ratingDone.current=true
    updateRating(myName,+pct,maxMP,totalMP,totalIMPs,roomCode,totalOrbits).then(r=>setRatingInfo(r)).catch(()=>{})
    // Also update AI bot ratings for this room
    if(typeof seeds!=="undefined"&&seeds){updateBotRatings(roomCode,totalOrbits,seeds).catch(()=>{})}
  },[])

  const checkPlayers=async()=>{
    setChecking(true)
    try{
      const room=await DB.getRoom(roomCode)
      if(!room){setChecking(false);setChecked(true);return}
      setPlayerCount(room.players.length)
      const found=[]
      for(const p of room.players){
        if(p.num===playerNum)continue
        const results=await DB.getAllResults(roomCode,p.num,totalOrbits)
        const done=results.every(r=>r!==null)
        const started=results.some(r=>r!==null)
        found.push({name:p.name,num:p.num,results,done,started,completed:results.filter(r=>r!==null).length})
      }
      setOthers(found)
      setChecked(true)
    }catch(e){console.error(e)}
    setChecking(false)
  }

  useEffect(()=>{checkPlayers()},[])

  const finished=others.filter(p=>p.done)
  const inProgress=others.filter(p=>p.started&&!p.done)

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",overflowY:"auto",fontFamily:F,color:"#e0e0e0"}}>
      <div style={{maxWidth:620,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:28,border:"1px solid rgba(255,255,255,0.08)",margin:"20px 0"}}>
        <h2 style={{textAlign:"center",fontSize:22,color:"#f1c40f",marginBottom:2}}>Session Complete</h2>
        <div style={{textAlign:"center",color:"#888",fontSize:12,marginBottom:4}}>{myName} · Room {roomCode}</div>
        <div style={{textAlign:"center",color:"#666",fontSize:11,marginBottom:16}}>
          {playerCount} player{playerCount!==1?"s":""} in room
          {finished.length>0?` · ${finished.length} finished`:""}
          {inProgress.length>0?` · ${inProgress.length} in progress`:""}
        </div>

        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:64,fontWeight:800,color:gc,lineHeight:1}}>{grade}</div>
          <div style={{fontSize:15,color:"#aaa",marginTop:4}}>{pct}% matchpoints</div>
        </div>

        {ratingInfo&&<div style={{marginBottom:18,padding:12,background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <span style={{color:"#aaa",fontSize:12}}>Player Rating</span>
            <span style={{fontSize:10,color:tierInfo(ratingInfo.rating).color,fontWeight:600}}>{tierInfo(ratingInfo.rating).icon} {tierInfo(ratingInfo.rating).name}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-around",textAlign:"center"}}>
            <div>
              <div style={{fontSize:28,fontWeight:800,color:tierInfo(ratingInfo.rating).color}}>{ratingInfo.rating}</div>
              <div style={{fontSize:9,color:"#666"}}>Rating</div>
            </div>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:ratingInfo.delta!==null?(ratingInfo.delta>0?"#2ecc71":ratingInfo.delta<0?"#e74c3c":"#888"):"#888"}}>{ratingInfo.delta!==null?(ratingInfo.delta>0?"+":"")+ratingInfo.delta:"NEW"}</div>
              <div style={{fontSize:9,color:"#666"}}>Change</div>
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#aaa"}}>{ratingInfo.prof.sessions}</div>
              <div style={{fontSize:9,color:"#666"}}>Sessions</div>
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1c40f"}}>{ratingInfo.prof.totalMaxMP>0?(ratingInfo.prof.totalMP/ratingInfo.prof.totalMaxMP*100).toFixed(1):"—"}%</div>
              <div style={{fontSize:9,color:"#666"}}>Career MP</div>
            </div>
          </div>
        </div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
          <div style={{textAlign:"center",padding:10,background:"rgba(255,255,255,0.03)",borderRadius:7}}>
            <div style={{color:"#888",fontSize:10}}>Matchpoints</div>
            <div style={{fontSize:18,fontWeight:700,color:pct>=50?"#2ecc71":"#e74c3c"}}>{totalMP}/{maxMP}</div>
          </div>
          <div style={{textAlign:"center",padding:10,background:"rgba(255,255,255,0.03)",borderRadius:7}}>
            <div style={{color:"#888",fontSize:10}}>Total IMPs</div>
            <div style={{fontSize:18,fontWeight:700,color:totalIMPs>0?"#3498db":"#e74c3c"}}>{totalIMPs>0?"+":""}{totalIMPs}</div>
          </div>
        </div>

        {finished.length>0&&<div style={{marginBottom:18}}>
          <div style={{color:"#3498db",fontSize:12,fontWeight:600,marginBottom:6}}>Head-to-Head vs Humans</div>
          {finished.map((opp,oi)=>{
            const w=orbits.filter((o,i)=>o.humanPnL>opp.results[i].pnl).length
            const l=orbits.filter((o,i)=>o.humanPnL<opp.results[i].pnl).length
            const t=totalOrbits-w-l
            const col=w>l?"#2ecc71":w<l?"#e74c3c":"#f1c40f"
            return (
              <div key={oi} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",marginBottom:3,background:"rgba(52,152,219,0.06)",borderRadius:6,borderLeft:`3px solid ${col}`}}>
                <span style={{fontSize:13,color:"#3498db",fontWeight:700}}>{opp.name} 👤</span>
                <span style={{fontSize:15,fontWeight:700,color:col}}>{w}W-{l}L{t>0?`-${t}T`:""}</span>
              </div>
            )
          })}
        </div>}

        <div style={{marginBottom:18}}>
          <div style={{color:"#888",fontSize:11,marginBottom:4}}>Orbit-by-Orbit</div>
          {orbits.map((o,i)=>{
            const opct=(o.mp/o.maxMp*100).toFixed(0),col=opct>=57?"#2ecc71":opct>=43?"#f1c40f":"#e74c3c"
            return (
              <div key={i} style={{display:"flex",alignItems:"center",padding:"4px 6px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                <span style={{fontSize:11,color:"#888",width:55}}>Orbit {o.orbitNumber}</span>
                <div style={{flex:1,height:5,background:"rgba(255,255,255,0.06)",borderRadius:2,margin:"0 6px"}}><div style={{height:"100%",width:`${opct}%`,background:col,borderRadius:2}}/></div>
                <span style={{fontSize:10,color:col,fontWeight:600,width:28}}>{opct}%</span>
                <span style={{fontSize:10,color:o.humanPnL>=0?"#2ecc71":"#e74c3c",width:45,textAlign:"right"}}>{o.humanPnL>=0?"+":""}{o.humanPnL}</span>
              </div>
            )
          })}
        </div>

        {inProgress.length>0&&<div style={{marginBottom:14,padding:10,background:"rgba(241,196,15,0.06)",borderRadius:8,border:"1px solid rgba(241,196,15,0.15)"}}>
          <div style={{color:"#f1c40f",fontSize:12,marginBottom:4}}>Still Playing</div>
          {inProgress.map((p,i)=> (
            <div key={i} style={{fontSize:11,color:"#aaa"}}>{p.name} — {p.completed}/{totalOrbits} orbits</div>
          ))}
        </div>}

        {others.length===0&&checked&&<div style={{textAlign:"center",marginBottom:16,padding:12,background:"rgba(52,152,219,0.06)",borderRadius:8,border:"1px solid rgba(52,152,219,0.15)"}}>
          <div style={{color:"#3498db",fontSize:13,marginBottom:6}}>No other players yet</div>
        </div>}

        <div style={{textAlign:"center",display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={onNew} style={{background:"linear-gradient(135deg,#27ae60,#1e8449)",color:"white",border:"none",borderRadius:10,padding:"12px 28px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:F}}>New Session</button>
          <button onClick={checkPlayers} disabled={checking} style={{background:"rgba(255,255,255,0.08)",color:"#e0e0e0",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"12px 22px",fontSize:14,cursor:"pointer",fontFamily:F}}>{checking?"Checking...":"Refresh"}</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// ROOM RESULTS VIEWER
// ═══════════════════════════════════════════════
function RoomResults({roomInfo,onBack,onViewPlayer}){
  const[players,setPlayers]=useState([])
  const[loading,setLoading]=useState(true)

  useEffect(()=>{
    async function load(){
      const room=await DB.getRoom(roomInfo.code)
      if(!room){setLoading(false);return}
      // Collect all orbit results for all players
      const pdata=[]
      const orbitPnLs={} // orbitNum -> [{playerNum, pnl}]
      for(const p of room.players){
        const results=await DB.getAllResults(roomInfo.code,p.num,room.orbits)
        const completed=results.filter(r=>r!==null)
        const totalPnL=completed.reduce((s,r)=>s+(r.pnl||0),0)
        const agg={hands:0,vpip:0,pfr:0,threeBet:0,betsRaises:0,calls:0,potsWon:0,threeBetOpp:0}
        for(const r of completed){if(r.stats){for(const k in agg)if(r.stats[k])agg[k]+=r.stats[k]}}
        for(let o=1;o<=room.orbits;o++){
          if(!orbitPnLs[o])orbitPnLs[o]=[]
          if(results[o-1])orbitPnLs[o].push({num:p.num,pnl:results[o-1].pnl||0})
        }
        const profile=await DB.getProfile(p.name)
        const rating=profile&&profile.history.length>0?calcWeightedRating(profile.history):null
        pdata.push({...p,results,completed:completed.length,total:room.orbits,totalPnL,stats:agg,rating,profile})
      }
      // Compute matchpoints for each player across shared orbits
      for(const p of pdata){
        let mp=0,maxMp=0
        for(let o=1;o<=room.orbits;o++){
          const myResult=p.results[o-1]
          if(!myResult||!orbitPnLs[o])continue
          const field=orbitPnLs[o].filter(x=>x.num!==p.num)
          if(field.length===0)continue
          const myPnl=myResult.pnl||0
          for(const opp of field){if(myPnl>opp.pnl)mp+=2;else if(myPnl===opp.pnl)mp+=1;maxMp+=2}
        }
        p.mp=mp;p.maxMp=maxMp;p.mpPct=maxMp>0?(mp/maxMp*100):0
      }
      pdata.sort((a,b)=>b.mpPct-a.mpPct||b.totalPnL-a.totalPnL)
      setPlayers(pdata);setLoading(false)
      // Mark results as viewed for all players in the room
      if(roomInfo.myName){DB.markResultsViewed(roomInfo.code,roomInfo.myName).catch(()=>{})}
    }
    load()
  },[roomInfo.code])

  const S=F
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",overflowY:"auto",fontFamily:S,color:"#e0e0e0"}}>
      <div style={{maxWidth:620,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:24,border:"1px solid rgba(255,255,255,0.08)",margin:"20px 0"}}>
        <h2 style={{textAlign:"center",fontSize:20,color:"#f1c40f",marginBottom:2}}>Room {roomInfo.code} Results</h2>
        <div style={{textAlign:"center",color:"#888",fontSize:12,marginBottom:16}}>{roomInfo.orbits} orbits · {players.length} player{players.length!==1?"s":""} · ranked by matchpoints</div>

        {loading?<div style={{textAlign:"center",color:"#888",padding:20}}>Loading...</div>:(
          <>
            {players.map((p,i)=>{
              const vpipPct=p.stats.hands>0?(p.stats.vpip/p.stats.hands*100).toFixed(0):"-"
              const pfrPct=p.stats.hands>0?(p.stats.pfr/p.stats.hands*100).toFixed(0):"-"
              const af=p.stats.calls>0?(p.stats.betsRaises/p.stats.calls).toFixed(1):"-"
              const wonPct=p.stats.hands>0?(p.stats.potsWon/p.stats.hands*100).toFixed(0):"-"
              const done=p.completed>=p.total
              return (
                <div key={i} onClick={()=>onViewPlayer(p)} style={{cursor:"pointer",padding:12,marginBottom:6,background:i===0?"rgba(241,196,15,0.06)":"rgba(255,255,255,0.02)",borderRadius:10,border:`1px solid ${i===0?"rgba(241,196,15,0.2)":"rgba(255,255,255,0.06)"}`,transition:"background 0.2s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:16,fontWeight:800,color:i===0?"#f1c40f":"#aaa"}}>#{i+1}</span>
                      <span style={{fontSize:15,fontWeight:700,color:"#e0e0e0"}}>{p.name}</span>
                      {p.rating&&<span style={{fontSize:11,color:tierInfo(p.rating).color,fontWeight:600}}>{tierInfo(p.rating).icon}{p.rating}</span>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:14,fontWeight:700,color:p.mpPct>=55?"#2ecc71":p.mpPct>=45?"#f1c40f":"#e74c3c"}}>{p.mpPct.toFixed(1)}% MP</div>
                      <div style={{fontSize:18,fontWeight:800,color:p.totalPnL>=0?"#2ecc71":"#e74c3c"}}>{p.totalPnL>=0?"+":""}{p.totalPnL}</div>
                    </div>
                  </div>
                  {done&&p.stats.hands>0&&<div style={{display:"flex",justifyContent:"space-around",textAlign:"center"}}>
                    <div><div style={{fontSize:13,fontWeight:600,color:"#ccc"}}>{vpipPct}%</div><div style={{fontSize:8,color:"#666"}}>VPIP</div></div>
                    <div><div style={{fontSize:13,fontWeight:600,color:"#ccc"}}>{pfrPct}%</div><div style={{fontSize:8,color:"#666"}}>PFR</div></div>
                    <div><div style={{fontSize:13,fontWeight:600,color:"#ccc"}}>{af}</div><div style={{fontSize:8,color:"#666"}}>AF</div></div>
                    <div><div style={{fontSize:13,fontWeight:600,color:"#ccc"}}>{wonPct}%</div><div style={{fontSize:8,color:"#666"}}>Won</div></div>
                    <div><div style={{fontSize:13,fontWeight:600,color:"#ccc"}}>{p.stats.hands}</div><div style={{fontSize:8,color:"#666"}}>Hands</div></div>
                  </div>}
                  {!done&&<div style={{fontSize:10,color:"#888"}}>Still playing — {p.completed}/{p.total} orbits complete</div>}
                  <div style={{textAlign:"right",fontSize:9,color:"#555",marginTop:4}}>tap for details →</div>
                </div>
              )
            })}
          </>
        )}

        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={onBack} style={{background:"rgba(255,255,255,0.08)",color:"#e0e0e0",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 24px",fontSize:14,cursor:"pointer",fontFamily:S}}>← Back</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// PLAYER DETAIL VIEW
// ═══════════════════════════════════════════════
function PlayerDetail({player,roomCode,totalOrbits,onBack}){
  const st=player.stats||{}
  const h=st.hands||0
  const vpipPct=h>0?(st.vpip/h*100).toFixed(1):"—"
  const pfrPct=h>0?(st.pfr/h*100).toFixed(1):"—"
  const tbPct=st.threeBetOpp>0?(st.threeBet/st.threeBetOpp*100).toFixed(1):(h>0?"0.0":"—")
  const af=st.calls>0?(st.betsRaises/st.calls).toFixed(2):"—"
  const wonPct=h>0?(st.potsWon/h*100).toFixed(1):"—"

  const prof=player.profile
  const rating=prof&&prof.history&&prof.history.length>0?calcWeightedRating(prof.history):null
  const tier=rating?tierInfo(rating):null

  // Classify play style
  let style="Unknown"
  if(h>=3){
    const v=st.vpip/h*100,p2=st.pfr/h*100
    if(v>55&&p2>25)style="LAG (Loose Aggressive)"
    else if(v>55)style="Loose Passive (Calling Station)"
    else if(v<30&&p2>20)style="TAG (Tight Aggressive)"
    else if(v<30)style="Nit (Tight Passive)"
    else if(p2>20)style="Aggressive"
    else style="Average"
  }

  const StatBox=({label,value,sub,color})=> (
    <div style={{textAlign:"center",padding:"10px 6px",background:"rgba(255,255,255,0.03)",borderRadius:8,flex:1,minWidth:70}}>
      <div style={{fontSize:20,fontWeight:700,color:color||"#e0e0e0"}}>{value}</div>
      <div style={{fontSize:10,color:"#888",fontWeight:600}}>{label}</div>
      {sub&&<div style={{fontSize:8,color:"#555",marginTop:2}}>{sub}</div>}
    </div>
  )

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",overflowY:"auto",fontFamily:F,color:"#e0e0e0"}}>
      <div style={{maxWidth:520,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:24,border:"1px solid rgba(255,255,255,0.08)",margin:"20px 0"}}>
        <h2 style={{textAlign:"center",fontSize:22,color:"#f1c40f",marginBottom:2}}>{player.name}</h2>
        {tier&&<div style={{textAlign:"center",fontSize:13,color:tier.color,marginBottom:4}}>{tier.icon} {tier.name} — Rating {rating}</div>}
        <div style={{textAlign:"center",color:"#888",fontSize:11,marginBottom:16}}>Room {roomCode} · {player.completed}/{totalOrbits} orbits · {h} hands</div>

        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:36,fontWeight:800,color:player.totalPnL>=0?"#2ecc71":"#e74c3c"}}>{player.totalPnL>=0?"+":""}{player.totalPnL}</div>
          <div style={{fontSize:12,color:"#888"}}>Total P&L</div>
        </div>

        <div style={{color:"#aaa",fontSize:12,fontWeight:600,marginBottom:6}}>Poker Stats</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
          <StatBox label="VPIP" value={vpipPct+"%"} sub={`${st.vpip||0}/${h} hands`} color={vpipPct>50?"#e74c3c":vpipPct>35?"#f1c40f":"#2ecc71"}/>
          <StatBox label="PFR" value={pfrPct+"%"} sub={`${st.pfr||0} raises`} color={pfrPct>30?"#e74c3c":pfrPct>18?"#f1c40f":"#3498db"}/>
          <StatBox label="3-Bet %" value={tbPct+"%"} sub={`${st.threeBet||0} 3bets`}/>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
          <StatBox label="Agg Factor" value={af} sub={`${st.betsRaises||0} bets / ${st.calls||0} calls`} color={af>2.5?"#e67e22":af>1.5?"#f1c40f":"#3498db"}/>
          <StatBox label="Pots Won" value={wonPct+"%"} sub={`${st.potsWon||0}/${h} hands`} color={wonPct>40?"#2ecc71":"#ccc"}/>
        </div>

        <div style={{padding:10,background:"rgba(255,255,255,0.02)",borderRadius:8,border:"1px solid rgba(255,255,255,0.05)",marginBottom:14}}>
          <div style={{color:"#aaa",fontSize:11,marginBottom:4}}>Play Style</div>
          <div style={{fontSize:15,fontWeight:700,color:"#f1c40f"}}>{style}</div>
          <div style={{fontSize:10,color:"#666",marginTop:2}}>
            {vpipPct!=="—"&&+vpipPct>50?"Playing too many hands. ":""}
            {vpipPct!=="—"&&+vpipPct<25?"Very selective hand selection. ":""}
            {af!=="—"&&+af>2.5?"Very aggressive postflop. ":""}
            {af!=="—"&&+af<1.0?"Passive — consider raising more. ":""}
          </div>
        </div>

        {prof&&prof.history&&prof.history.length>1&&<div style={{marginBottom:14}}>
          <div style={{color:"#aaa",fontSize:11,marginBottom:4}}>Rating History (last {Math.min(prof.history.length,10)} sessions)</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:3,height:50}}>
            {prof.history.slice(-10).map((h2,i)=>{
              const pct=h2.mpPct,maxH=50,barH=Math.max(4,pct/100*maxH*1.5)
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                  <div style={{width:"100%",height:barH,background:tierInfo(pct).color,borderRadius:2,minWidth:8}}/>
                  <div style={{fontSize:7,color:"#555",marginTop:2}}>{pct.toFixed(0)}</div>
                </div>
              )
            })}
          </div>
        </div>}

        <div style={{textAlign:"center"}}>
          <button onClick={onBack} style={{background:"rgba(255,255,255,0.08)",color:"#e0e0e0",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 24px",fontSize:14,cursor:"pointer",fontFamily:F}}>← Back to Results</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// PLAYER LOOKUP (no room code needed)
// ═══════════════════════════════════════════════
function PlayerLookup({onBack}){
  const[name,setName]=useState("")
  const[prof,setProf]=useState(null)
  const[searched,setSearched]=useState(false)
  const lookup=async()=>{
    if(!name.trim())return
    const p=await DB.getProfile(name.trim())
    setProf(p);setSearched(true)
  }
  const rating=prof&&prof.history&&prof.history.length>0?calcWeightedRating(prof.history):null
  const tier=rating?tierInfo(rating):null
  const I={background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"10px 14px",fontSize:15,color:"#e0e0e0",fontFamily:F,width:"100%",boxSizing:"border-box",outline:"none"}
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,fontFamily:F,color:"#e0e0e0"}}>
      <div style={{maxWidth:420,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:16,padding:32,border:"1px solid rgba(255,255,255,0.08)"}}>
        <h2 style={{textAlign:"center",fontSize:20,color:"#f1c40f",marginBottom:16}}>Player Lookup</h2>
        <div style={{marginBottom:12}}><input placeholder="Player name" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&lookup()} style={I}/></div>
        <button onClick={lookup} style={{background:"linear-gradient(135deg,#8e44ad,#6c3483)",color:"#fff",border:"none",borderRadius:10,padding:"12px 28px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:F,width:"100%",marginBottom:12}}>Look Up</button>

        {searched&&!prof&&<div style={{textAlign:"center",color:"#e74c3c",fontSize:13,padding:12}}>No profile found for "{name}"</div>}
        {prof&&<div style={{padding:14,background:"rgba(255,255,255,0.03)",borderRadius:10,border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:16,fontWeight:700}}>{prof.name}</span>
            {tier&&<span style={{fontSize:12,color:tier.color,fontWeight:600}}>{tier.icon} {tier.name}</span>}
          </div>
          <div style={{display:"flex",justifyContent:"space-around",textAlign:"center",marginBottom:10}}>
            <div><div style={{fontSize:24,fontWeight:800,color:tier?tier.color:"#888"}}>{rating||"—"}</div><div style={{fontSize:9,color:"#666"}}>Rating</div></div>
            <div><div style={{fontSize:18,fontWeight:700,color:"#aaa"}}>{prof.sessions}</div><div style={{fontSize:9,color:"#666"}}>Sessions</div></div>
            <div><div style={{fontSize:18,fontWeight:700,color:prof.totalMaxMP>0&&(prof.totalMP/prof.totalMaxMP*100)>=50?"#2ecc71":"#e74c3c"}}>{prof.totalMaxMP>0?(prof.totalMP/prof.totalMaxMP*100).toFixed(1):"—"}%</div><div style={{fontSize:9,color:"#666"}}>Career MP</div></div>
            <div><div style={{fontSize:18,fontWeight:700,color:"#f1c40f"}}>{prof.bestPct>0?prof.bestPct.toFixed(1):"—"}%</div><div style={{fontSize:9,color:"#666"}}>Best</div></div>
          </div>
          <div><div style={{fontSize:11,fontWeight:600,color:prof.totalIMPs>0?"#3498db":"#e74c3c"}}>Total IMPs: {prof.totalIMPs>0?"+":""}{prof.totalIMPs}</div></div>
          {prof.history&&prof.history.length>1&&<div style={{marginTop:8}}>
            <div style={{color:"#888",fontSize:10,marginBottom:3}}>Last {Math.min(prof.history.length,10)} sessions</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:3,height:40}}>
              {prof.history.slice(-10).map((h,i)=>{
                const barH=Math.max(3,h.mpPct/100*55)
                return (
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div style={{width:"100%",height:barH,background:tierInfo(h.mpPct).color,borderRadius:2,minWidth:6}}/>
                    <div style={{fontSize:6,color:"#555",marginTop:1}}>{h.mpPct.toFixed(0)}</div>
                  </div>
                )
              })}
            </div>
          </div>}
        </div>}

        <button onClick={onBack} style={{background:"none",border:"none",color:"#666",fontSize:12,cursor:"pointer",fontFamily:F,marginTop:12,width:"100%",textAlign:"center"}}>← Back</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// RANKINGS / LEADERBOARD
// ═══════════════════════════════════════════════
function Rankings({onBack}){
  const[entries,setEntries]=useState([])
  const[loading,setLoading]=useState(true)
  useEffect(()=>{
    async function load(){
      const names=new Set()
      // Load known bot names
      AI_PROFILES.forEach(p=>names.add(p.name))
      // Load room index to discover human names
      const idx=await DB.getRoomIndex()
      for(const g of idx){if(g.players)g.players.forEach(n=>names.add(n))}
      // Fetch profiles
      const profiles=[]
      for(const n of names){
        const prof=await DB.getProfile(n)
        if(prof&&prof.history&&prof.history.length>0){
          const rating=calcWeightedRating(prof.history)
          const tier=tierInfo(rating)
          const careerPct=prof.totalMaxMP>0?(prof.totalMP/prof.totalMaxMP*100).toFixed(1):"—"
          profiles.push({name:prof.name||n,rating,tier,sessions:prof.sessions,careerPct,bestPct:prof.bestPct,isBot:!!prof.isBot,totalIMPs:prof.totalIMPs||0})
        }
      }
      profiles.sort((a,b)=>b.rating-a.rating)
      setEntries(profiles);setLoading(false)
    }
    load()
  },[])
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",overflowY:"auto",fontFamily:F,color:"#e0e0e0"}}>
      <div style={{maxWidth:520,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:24,border:"1px solid rgba(255,255,255,0.08)",margin:"20px 0"}}>
        <h2 style={{textAlign:"center",fontSize:20,color:"#f1c40f",marginBottom:2}}>🏆 Rankings</h2>
        <div style={{textAlign:"center",color:"#888",fontSize:11,marginBottom:16}}>All players & AI bots by weighted matchpoint %</div>
        {loading?<div style={{textAlign:"center",color:"#888",padding:20}}>Loading...</div>:(
          entries.length===0?<div style={{textAlign:"center",color:"#666",padding:20}}>No rated players yet. Play a session!</div>:
          entries.map((e,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",marginBottom:4,background:i<3?"rgba(241,196,15,0.04)":"rgba(255,255,255,0.02)",borderRadius:8,border:`1px solid ${i===0?"rgba(241,196,15,0.2)":"rgba(255,255,255,0.06)"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,fontWeight:800,color:i===0?"#f1c40f":i===1?"#94a3b8":i===2?"#cd7f32":"#555",minWidth:24}}>#{i+1}</span>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14,fontWeight:700,color:e.isBot?"#888":"#e0e0e0"}}>{e.name}</span>
                    {e.isBot&&<span style={{fontSize:8,color:"#555",background:"rgba(255,255,255,0.06)",padding:"1px 5px",borderRadius:3}}>BOT</span>}
                    <span style={{fontSize:10,color:e.tier.color}}>{e.tier.icon}</span>
                  </div>
                  <div style={{fontSize:9,color:"#555"}}>{e.sessions} session{e.sessions!==1?"s":""} · career {e.careerPct}% · best {e.bestPct.toFixed(0)}%</div>
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:22,fontWeight:800,color:e.tier.color}}>{e.rating}</div>
                <div style={{fontSize:9,color:"#666"}}>{e.tier.name}</div>
              </div>
            </div>
          ))
        )}
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={onBack} style={{background:"rgba(255,255,255,0.08)",color:"#e0e0e0",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 24px",fontSize:14,cursor:"pointer",fontFamily:F}}>← Back</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// MAIN CONTROLLER
// ═══════════════════════════════════════════════
export default function App(){
  const[view,setView]=useState("lobby")
  const[roomInfo,setRoomInfo]=useState(null)
  const[game,setGame]=useState(null)
  const[completedOrbits,setCompletedOrbits]=useState([])
  const[sessionMP,setSessionMP]=useState(0)
  const[sessionMaxMP,setSessionMaxMP]=useState(0)
  const[sessionIMPs,setSessionIMPs]=useState(0)
  const[currentOrbit,setCurrentOrbit]=useState(null)
  const[selectedPlayer,setSelectedPlayer]=useState(null)
  const rngRef=useRef(Date.now())
  const liveRng=useCallback(()=>{rngRef.current=(rngRef.current*16807)%2147483647;if(rngRef.current<=0)rngRef.current+=2147483646;return(rngRef.current-1)/2147483646},[])

  function initLocalGame(seed,orbitNum){
    return{seed,handNumber:0,handInOrbit:0,phase:"ready",
      players:[{id:0,name:"You",chips:STARTING,holeCards:[],folded:false,currentBet:0,totalBet:0,isHuman:true,style:null},
        ...BOTS.map((b,i)=>({id:i+1,name:b.name,chips:STARTING,holeCards:[],folded:false,currentBet:0,totalBet:0,isHuman:false,style:b.style,profile:{agg:b.agg,tight:b.tight,bluff:b.bluff,skill:b.skill}}))],
      community:[],communityDeck:[],pot:0,betToCall:0,activeIdx:-1,dealerIdx:0,raisesThisStreet:0,actedThisStreet:{},handLog:[],orbitNumber:orbitNum,message:"",
      stats:{hands:0,vpip:0,pfr:0,threeBet:0,betsRaises:0,calls:0,potsWon:0,threeBetOpp:0},
      handFlags:{vpip:false,pfr:false,threeBet:false}}
  }

  const onJoined=useCallback((info,skipShareCode)=>{
    setRoomInfo(info)
    if(skipShareCode){
      // Go straight to playing (joining existing game)
      const g=initLocalGame(info.seeds[0],1)
      setGame(g);setView("playing");setTimeout(()=>startHand(),100)
    }else{
      setView("shareCode")
    }
  },[])

  const startPlaying=useCallback(()=>{
    const orbitNum=1
    const g=initLocalGame(roomInfo.seeds[0],orbitNum)
    setGame(g);setView("playing");setTimeout(()=>startHand(),100)
  },[roomInfo])

  const startHand=useCallback(()=>{
    setGame(prev=>{
      const g=JSON.parse(JSON.stringify(prev));g.handNumber++;g.handInOrbit++;g.phase="preflop";g.community=[]
      g.raisesThisStreet=0;g.actedThisStreet={};g.message=`Hand ${g.handInOrbit} of ${HANDS_PER_ORBIT}`
      g.handFlags={vpip:false,pfr:false,threeBet:false};g.stats.hands++
      const handRng=mkRng(g.seed+g.handNumber*997),d=shuf(mkDeck(),handRng);g.communityDeck=d.slice(12,17)
      g.players=g.players.map((p,i)=>({...p,holeCards:[d[i*2],d[i*2+1]],folded:false,currentBet:0,totalBet:0}))
      g.pot=0;g.players.forEach(p=>{const a=Math.min(ANTE,p.chips);p.chips-=a;p.totalBet=a});g.pot=g.players.reduce((s,p)=>s+p.totalBet,0)
      const si=(g.dealerIdx+1)%6,bi=(g.dealerIdx+2)%6
      const sb=Math.min(SB,g.players[si].chips);g.players[si].chips-=sb;g.players[si].currentBet=sb;g.players[si].totalBet+=sb
      const bb=Math.min(BB,g.players[bi].chips);g.players[bi].chips-=bb;g.players[bi].currentBet=bb;g.players[bi].totalBet+=bb
      g.pot+=sb+bb;g.betToCall=BB
      let first=(g.dealerIdx+3)%6,s=0;while(s<6&&(g.players[first].folded||g.players[first].chips<=0)){first=(first+1)%6;s++}
      g.activeIdx=first;if(g.players.filter(p=>!p.folded&&p.chips>0).length<2)g.phase="showdown"
      return g
    })
  },[])

  const processAction=useCallback((action,amount=0)=>{
    setGame(prev=>{
      const g=JSON.parse(JSON.stringify(prev)),idx=g.activeIdx,p=g.players[idx]
      if(action==="fold")p.folded=true;else if(action==="check"){}
      else if(action==="call"){const tc=Math.min(g.betToCall-p.currentBet,p.chips);p.chips-=tc;p.currentBet+=tc;p.totalBet+=tc;g.pot+=tc}
      else if(action==="raise"){const ra=Math.min(Math.max(amount,g.betToCall+BB),p.chips+p.currentBet);const ta=ra-p.currentBet;p.chips-=ta;p.currentBet=ra;p.totalBet+=ta;g.pot+=ta;g.betToCall=ra;g.raisesThisStreet++;g.actedThisStreet={}}
      // Track human stats
      if(idx===0&&g.stats){
        if(g.phase==="preflop"&&(action==="call"||action==="raise"))g.handFlags.vpip=true
        if(g.phase==="preflop"&&action==="raise"){g.handFlags.pfr=true;if(g.raisesThisStreet>=2)g.handFlags.threeBet=true}
        if(g.phase==="preflop"&&g.raisesThisStreet>=1&&action!=="raise")g.stats.threeBetOpp++
        if(action==="raise")g.stats.betsRaises++
        if(action==="call")g.stats.calls++
      }
      g.actedThisStreet[idx]=true
      if(g.players.filter(x=>!x.folded).length<=1){g.phase="showdown";return g}
      if(g.players.every(x=>x.folded||x.chips===0||(g.actedThisStreet[x.id]&&x.currentBet===g.betToCall))){
        g.players.forEach(x=>x.currentBet=0);g.betToCall=0;g.raisesThisStreet=0;g.actedThisStreet={}
        if(g.phase==="preflop"){g.phase="flop";g.community=g.communityDeck.slice(0,3)}
        else if(g.phase==="flop"){g.phase="turn";g.community=g.communityDeck.slice(0,4)}
        else if(g.phase==="turn"){g.phase="river";g.community=g.communityDeck.slice(0,5)}
        else{g.phase="showdown";return g}
        let f=(g.dealerIdx+1)%6,s2=0;while(s2<6&&(g.players[f].folded||g.players[f].chips<=0)){f=(f+1)%6;s2++}
        if(s2>=6){g.phase="showdown";return g};g.activeIdx=f;return g
      }
      let next=(idx+1)%6,s3=0;while(s3<6&&(g.players[next].folded||g.players[next].chips<=0)){next=(next+1)%6;s3++}
      if(s3>=6){g.phase="showdown";return g};g.activeIdx=next;return g
    })
  },[])

  // AI turns
  useEffect(()=>{
    if(!game||!["preflop","flop","turn","river"].includes(game.phase))return
    const cp=game.players[game.activeIdx];if(!cp||cp.isHuman||cp.folded||cp.chips<=0)return
    const timer=setTimeout(()=>{
      const toCall=Math.max(game.betToCall-cp.currentBet,0),posFromBtn=((game.activeIdx-game.dealerIdx)+6)%6
      let dec=aiDecide(cp.holeCards,game.community,game.pot,toCall,cp.chips,posFromBtn,game.phase,liveRng,cp.profile)
      if(dec.action==="raise"&&game.raisesThisStreet>=MAX_RAISES)dec=toCall>0?{action:"call"}:{action:"check"}
      if(dec.action==="raise"){const minBet=game.betToCall+BB;let amt=Math.max(dec.amount||minBet,minBet);amt=Math.min(amt,cp.chips+cp.currentBet);if(amt<=game.betToCall)dec=toCall>0?{action:"call"}:{action:"check"};else dec.amount=amt}
      processAction(dec.action,dec.amount||0)
    },300+liveRng()*300)
    return()=>clearTimeout(timer)
  },[game?.phase,game?.activeIdx,game?.players,processAction,liveRng,game?.community,game?.pot,game?.betToCall,game?.raisesThisStreet])

  // Showdown
  useEffect(()=>{
    if(!game||game.phase!=="showdown")return
    const timer=setTimeout(()=>{
      setGame(prev=>{
        const g=JSON.parse(JSON.stringify(prev));g.community=g.communityDeck.slice(0,5)
        const active=g.players.filter(p=>!p.folded);let winnerName=""
        if(active.length<=1){const w=active.length===1?active[0]:g.players[0];w.chips+=g.pot;winnerName=w.name}
        else{const result=resolvePots(g.players,g.community);winnerName=result.winners.map(w=>g.players[w.id].name).join(", ")}
        const humanR=evalHand(g.players[0].holeCards,g.community)
        const startChips=g.handLog.length===0?STARTING:(()=>{let c=STARTING;for(const h of g.handLog)c+=h.humanResult;return c})()
        const handPnL=g.players[0].chips-startChips
        // Finalize hand stats
        if(g.stats&&g.handFlags){
          if(g.handFlags.vpip)g.stats.vpip++
          if(g.handFlags.pfr)g.stats.pfr++
          if(g.handFlags.threeBet)g.stats.threeBet++
          if(handPnL>0||(winnerName.includes("You")))g.stats.potsWon++
        }
        // Sound: chip rattle if human won
        if(handPnL>0||winnerName.includes("You"))setTimeout(()=>playChipRattle(),100)
        g.handLog.push({handInOrbit:g.handInOrbit,humanCards:[...g.players[0].holeCards],community:[...g.community],humanResult:handPnL,winnerName,humanHandName:handName(humanR),humanFolded:g.players[0].folded,pot:g.pot})
        g.message=`${winnerName} wins $${g.pot}`;g.phase="handResult";return g
      })
    },600)
    return()=>clearTimeout(timer)
  },[game?.phase])

  // Next hand
  const nextHand=useCallback(()=>{
    if(!game||!roomInfo)return
    if(game.handInOrbit>=HANDS_PER_ORBIT){
      // Orbit done — compute AI, store, show scorecard
      const humanPnL=game.players[0].chips-STARTING
      const aiResults=[];for(let i=0;i<NUM_AI;i++){const pnl=simOrbit(game.seed,game.dealerIdx-HANDS_PER_ORBIT+1,i);aiResults.push({name:AI_PROFILES[i].name,pnl,isHuman:false})}
      const orbitResult={orbitNumber:game.orbitNumber,humanPnL,aiResults,handLog:game.handLog.slice(-HANDS_PER_ORBIT),roomCode:roomInfo.code,playerNum:roomInfo.playerNum}
      // Store to Firebase with AI pnls for bot rating computation
      const aiPnls=aiResults.map(a=>({name:a.name,pnl:a.pnl}))
      DB.storeOrbitResult(roomInfo.code,roomInfo.playerNum,game.orbitNumber,{pnl:humanPnL,stats:game.stats||{},aiPnls}).catch(e=>console.error("Store error:",e))
      setCurrentOrbit(orbitResult);setView("orbitScore")
    }else{
      setGame(prev=>({...prev,dealerIdx:(prev.dealerIdx+1)%6}));startHand()
    }
  },[game,startHand,roomInfo])

  // After viewing orbit score
  const onOrbitNext=useCallback((mp,maxMp,imps)=>{
    setSessionMP(prev=>prev+mp);setSessionMaxMP(prev=>prev+maxMp);setSessionIMPs(prev=>prev+imps)
    setCompletedOrbits(prev=>[...prev,{...currentOrbit,mp,maxMp,imps}])
    if(game.orbitNumber>=roomInfo.orbits){
      setView("sessionEnd")
    }else{
      const nextOrbitNum=game.orbitNumber+1
      const g=initLocalGame(roomInfo.seeds[nextOrbitNum-1],nextOrbitNum)
      setGame(g);setCurrentOrbit(null);setView("playing");setTimeout(()=>startHand(),100)
    }
  },[currentOrbit,game,roomInfo,startHand])

  const onViewResults=useCallback(async(code,name)=>{
    if(!code){setView("playerLookup");return}
    if(code==="__rankings__"){setView("rankings");return}
    try{
      const room=await DB.getRoom(code)
      if(!room)return alert("Game not found")
      if(name){
        const player=room.players.find(p=>p.name===name)
        if(!player)return alert("Name not found in room")
      }
      setRoomInfo({code,seeds:room.seeds,orbits:room.orbits,playerNum:1,myName:name||"",players:room.players})
      setView("viewResults")
    }catch(e){alert("Error: "+e.message)}
  },[])

  const reset=useCallback(()=>{setView("lobby");setGame(null);setRoomInfo(null);setCompletedOrbits([]);setSessionMP(0);setSessionMaxMP(0);setSessionIMPs(0);setCurrentOrbit(null);setSelectedPlayer(null)},[])

  // ─── RENDER ───
  if(view==="lobby")return <Lobby onJoined={onJoined} onViewResults={onViewResults}/>
  if(view==="shareCode"&&roomInfo)return <ShareCode code={roomInfo.code} orbits={roomInfo.orbits} onStart={startPlaying}/>
  if(view==="orbitScore"&&currentOrbit)return <OrbitScore orbit={currentOrbit} sessionMP={sessionMP} sessionMaxMP={sessionMaxMP} sessionIMPs={sessionIMPs} orbitNum={game.orbitNumber} totalOrbits={roomInfo.orbits} onNext={onOrbitNext}/>
  if(view==="sessionEnd")return <SessionResults orbits={completedOrbits} totalMP={sessionMP+0} maxMP={sessionMaxMP+0} totalIMPs={sessionIMPs+0} myName={roomInfo.myName} roomCode={roomInfo.code} playerNum={roomInfo.playerNum} totalOrbits={roomInfo.orbits} seeds={roomInfo.seeds} onNew={reset}/>
  if(view==="viewResults"&&roomInfo)return selectedPlayer
    ? <PlayerDetail player={selectedPlayer} roomCode={roomInfo.code} totalOrbits={roomInfo.orbits} onBack={()=>setSelectedPlayer(null)}/>
    : <RoomResults roomInfo={roomInfo} onBack={reset} onViewPlayer={(p)=>setSelectedPlayer(p)}/>
  if(view==="playerLookup")return <PlayerLookup onBack={reset}/>
  if(view==="rankings")return <Rankings onBack={reset}/>

  if(!game)return <Lobby onJoined={onJoined} onViewResults={onViewResults}/>

  // Hand result
  if(game.phase==="handResult"){
    const r=game.handLog[game.handLog.length-1],orbitPnL=game.players[0].chips-STARTING
    return <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",padding:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:F,color:"#e0e0e0"}}>
      <div style={{maxWidth:500,width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:14,padding:22,border:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <span style={{fontSize:11,color:"#888"}}>Hand {r.handInOrbit}/{HANDS_PER_ORBIT} · Orbit {game.orbitNumber}/{roomInfo.orbits} · Room {roomInfo.code}</span>
          <h2 style={{fontSize:18,color:"#f1c40f",margin:"6px 0 0"}}>{game.message}</h2>
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:12}}>
          <div style={{textAlign:"center"}}><div style={{color:"#aaa",fontSize:10,marginBottom:3}}>Your Cards</div><div style={{display:"flex"}}>{r.humanCards.map((c,i)=><Card key={i} card={c} small/>)}</div><div style={{color:"#95a5a6",fontSize:10,marginTop:2}}>{r.humanFolded?"Folded":r.humanHandName}</div></div>
          <div style={{textAlign:"center"}}><div style={{color:"#aaa",fontSize:10,marginBottom:3}}>Board</div><div style={{display:"flex"}}>{r.community.map((c,i)=><Card key={i} card={c} small/>)}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:20,marginBottom:14}}>
          <div style={{textAlign:"center"}}><div style={{color:"#aaa",fontSize:10}}>This Hand</div><div style={{fontSize:18,fontWeight:700,color:r.humanResult>=0?"#2ecc71":"#e74c3c"}}>{r.humanResult>=0?"+":""}{r.humanResult}</div></div>
          <div style={{textAlign:"center"}}><div style={{color:"#aaa",fontSize:10}}>Orbit P&L</div><div style={{fontSize:18,fontWeight:700,color:orbitPnL>=0?"#2ecc71":"#e74c3c"}}>{orbitPnL>=0?"+":""}{orbitPnL}</div></div>
          <div style={{textAlign:"center"}}><div style={{color:"#aaa",fontSize:10}}>Stack</div><div style={{fontSize:18,fontWeight:700,color:"#f1c40f"}}>${game.players[0].chips}</div></div>
        </div>
        <div style={{textAlign:"center",padding:"6px 0",marginBottom:10,background:"rgba(255,255,255,0.03)",borderRadius:7}}>
          <span style={{color:game.handInOrbit>=HANDS_PER_ORBIT?"#f1c40f":"#888",fontSize:12,fontWeight:game.handInOrbit>=HANDS_PER_ORBIT?600:400}}>
            {game.handInOrbit>=HANDS_PER_ORBIT?"Orbit complete — time to score":`${HANDS_PER_ORBIT-game.handInOrbit} hand${HANDS_PER_ORBIT-game.handInOrbit>1?"s":""} remaining`}
          </span>
        </div>
        <div style={{textAlign:"center"}}><button onClick={nextHand} style={{background:"linear-gradient(135deg,#27ae60,#1e8449)",color:"white",border:"none",borderRadius:9,padding:"10px 28px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:F}}>{game.handInOrbit>=HANDS_PER_ORBIT?"Score This Orbit →":"Next Hand →"}</button></div>
      </div>
    </div>
  }

  // Main table
  const cp=game.players[game.activeIdx]||{}
  const isHumanTurn=cp.isHuman&&!cp.folded&&["preflop","flop","turn","river"].includes(game.phase)
  const humanPnL=game.players[0].chips-STARTING

  // Sound: ding when it's your turn
  const prevTurnRef=useRef(false)
  useEffect(()=>{
    if(isHumanTurn&&!prevTurnRef.current)playDing()
    prevTurnRef.current=isHumanTurn
  },[isHumanTurn])

  const[showRules,setShowRules]=useState(false)

  return <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0a0a14,#0d1117,#0a0f0a)",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:F,color:"#e0e0e0",padding:"8px 8px 0",position:"relative"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",maxWidth:660,marginBottom:4,padding:"0 4px"}}>
      <div style={{fontSize:11,color:"#888"}}>Hand {game.handInOrbit}/{HANDS_PER_ORBIT} · Orbit {game.orbitNumber}/{roomInfo.orbits} · {SB}/{BB}+{ANTE}</div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <button onClick={()=>setShowRules(!showRules)} style={{background:"none",border:"1px solid rgba(255,255,255,0.15)",borderRadius:12,width:20,height:20,fontSize:10,color:"#888",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>?</button>
        <span style={{fontSize:9,background:"rgba(241,196,15,0.15)",color:"#f1c40f",padding:"2px 6px",borderRadius:4}}>Room {roomInfo.code}</span>
        <div style={{background:"rgba(255,255,255,0.05)",borderRadius:5,padding:"1px 6px"}}>
          <span style={{fontSize:10,color:"#888"}}>P&L </span>
          <span style={{fontSize:12,fontWeight:600,color:humanPnL>=0?"#2ecc71":"#e74c3c"}}>{humanPnL>=0?"+":""}{humanPnL}</span>
        </div>
      </div>
    </div>
    {showRules&&<div style={{position:"absolute",top:40,left:"50%",transform:"translateX(-50%)",zIndex:50,maxWidth:360,width:"90%",background:"rgba(10,10,20,0.96)",border:"1px solid rgba(241,196,15,0.3)",borderRadius:12,padding:16,fontSize:12,color:"#ccc",lineHeight:1.6,boxShadow:"0 8px 30px rgba(0,0,0,0.6)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><strong style={{color:"#f1c40f"}}>How It Works</strong><button onClick={()=>setShowRules(false)} style={{background:"none",border:"none",color:"#888",fontSize:16,cursor:"pointer"}}>✕</button></div>
      <p style={{marginBottom:6}}>This is Texas Hold'em, but <strong style={{color:"#f1c40f"}}>every player gets the same cards</strong> in the same seat against the same AI bots. Each orbit starts with {STARTING} chips ({SB}/{BB} blinds, {ANTE} ante).</p>
      <p style={{marginBottom:6}}>After each orbit, your chip count is compared to every other player who held the same cards. Fewest chips = 0 matchpoints, most chips = N−1 matchpoints. Most matchpoints wins.</p>
      <p style={{color:"#888",fontSize:10,fontStyle:"italic"}}>No gambling — only decisions matter.</p>
    </div>}
    <div style={{position:"relative",width:"100%",maxWidth:660,height:380}}>
      <div style={{position:"absolute",top:50,left:50,right:50,bottom:50,borderRadius:"50%",background:"radial-gradient(ellipse at center,#1a4a2e 0%,#0d3320 60%,#082218 100%)",border:"6px solid #2c1810",boxShadow:"inset 0 0 40px rgba(0,0,0,0.5), 0 4px 20px rgba(0,0,0,0.4)"}}/>
      <div style={{position:"absolute",top:"41%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",zIndex:5}}>
        <div style={{background:"rgba(0,0,0,0.5)",borderRadius:8,padding:"4px 14px",border:"1px solid rgba(241,196,15,0.4)"}}>
          <span style={{color:"#f1c40f",fontSize:18,fontWeight:800}}>POT ${game.pot}</span>
        </div>
      </div>
      <div style={{position:"absolute",top:"52%",left:"50%",transform:"translate(-50%,-50%)",display:"flex",gap:1.5,zIndex:5}}>
        {game.community.map((c,i)=><Card key={i} card={c} small/>)}
      </div>
      <div style={{position:"absolute",top:"34%",left:"50%",transform:"translateX(-50%)",zIndex:5}}>
        <span style={{color:"#aaa",fontSize:9,textTransform:"uppercase",letterSpacing:2,background:"rgba(0,0,0,0.3)",padding:"1px 6px",borderRadius:3}}>{game.phase}</span>
      </div>
      {game.players.map((p,i)=><Seat key={i} player={p} position={i} isActive={i===game.activeIdx} showCards={game.phase==="showdown"} dealerIndex={game.dealerIdx}/>)}
    </div>
    {isHumanTurn&&<BetControls phase={game.phase} pot={game.pot} betToCall={game.betToCall} playerBet={cp.currentBet||0} playerChips={cp.chips||0} raises={game.raisesThisStreet} onAction={processAction}/>}
  </div>
}
