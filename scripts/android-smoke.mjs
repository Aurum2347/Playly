// Run against a debug emulator containing a single imported Playly-test.wav.
import assert from 'node:assert/strict'
const port = Number(process.argv[2] || 9222)
const pages = await (
  await fetch('http://127.0.0.1:' + port + '/json/list')
).json()
const page = pages.find((p) => p.url === 'https://playly.invalid/')
assert.ok(page, 'Open Playly and forward its debug WebView socket first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let id = 0
async function evaluate(expression) {
  const request = ++id
  const reply = new Promise((resolve) => {
    function receive(event) {
      const data = JSON.parse(event.data)
      if (data.id !== request) return
      ws.removeEventListener('message', receive)
      resolve(data.result)
    }
    ws.addEventListener('message', receive)
  })
  ws.send(
    JSON.stringify({
      id: request,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }),
  )
  const result = await reply
  assert.ok(
    !result.exceptionDetails,
    result.exceptionDetails?.exception?.description,
  )
  return result.result.value
}
async function until(expression) {
  for (let i = 0; i < 40; i++) {
    if (await evaluate(expression)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  assert.fail(expression)
}
try {
  await until(
    "document.querySelector('.track') && document.querySelector('.track').textContent.includes('Playly-test.wav')",
  )
  await evaluate("document.querySelector('.track').click()")
  await until('state.playing && state.pos>0 && state.duration>=59000')
  await evaluate("$('expand').click(); $('npToggle').click()")
  await until("$('now').open && !state.playing")
  await evaluate(
    "$('seek').value=12000; $('seek').dispatchEvent(new Event('change'))",
  )
  await until('Math.abs(state.pos-12000)<1200')
  const liked = await evaluate('likes.has(state.uri)')
  await evaluate("$('npLike').click()")
  assert.equal(await evaluate('likes.has(state.uri)'), !liked)
  await evaluate(
    "$('npLike').click(); $('collapse').click(); document.querySelector('.row button:last-child').click()",
  )
  await evaluate(
    "[...$('sheetBody').querySelectorAll('button')].find(b=>b.textContent==='Добавить в плейлист').click()",
  )
  await evaluate(
    "[...$('sheetBody').querySelectorAll('button')].find(b=>b.textContent==='Новый плейлист').click()",
  )
  await evaluate(
    "window.auditListName='Playly smoke '+Date.now(); $('sheetBody').querySelector('input').value=auditListName; $('sheetBody').querySelector('button').click(); document.querySelector('[data-page=lists]').click()",
  )
  await evaluate(
    "[...$('content').querySelectorAll('button')].find(b=>b.textContent===auditListName+' · 1').click()",
  )
  assert.ok(await evaluate("!!$('content').querySelector('.track')"))
  await evaluate(
    "$('add').click(); [...$('sheetBody').querySelectorAll('button')].find(b=>b.textContent==='Удалить плейлист').click(); $('sheetBody').querySelector('button').click()",
  )
  await evaluate(
    "go('library'); $('search').value='absent track 123'; $('search').dispatchEvent(new Event('input'))",
  )
  assert.ok(
    await evaluate("$('content').textContent.includes('Ничего не найдено')"),
  )
  await evaluate("go('library'); $('settings').click()")
  assert.ok(
    await evaluate(
      "$('sheetBody').textContent.includes('Проверить Android-версию')",
    ),
  )
  await evaluate(
    "[...$('sheetBody').querySelectorAll('button')].find(b=>b.textContent==='Эквалайзер').click(); [...$('sheetBody').querySelectorAll('button')].find(b=>b.textContent==='Больше баса').click()",
  )
  await until('Android.preset()===1')
  await evaluate("Android.control('preset',0); $('expand').click()")
  assert.ok(
    await evaluate(
      "getComputedStyle($('now')).animationName==='sheet-in' || matchMedia('(prefers-reduced-motion: reduce)').matches",
    ),
  )
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
  const nativeState = await evaluate('({...state})')
  try {
    await evaluate("if(!state.shuffle) Android.control('shuffle',0)")
    // Tap repeat through its public control until it is off.
    for (let i = 0; i < (3 - nativeState.repeat) % 3; i++) {
      await evaluate("Android.control('repeat',0)")
    }
    await until('state.shuffle && state.repeat===0')
    await evaluate(
      "Android.control('seek',state.duration-500); Android.control('toggle',0)",
    )
    await until('!state.playing && state.pos<1000')
  } finally {
    if (!nativeState.shuffle) await evaluate("Android.control('shuffle',0)")
    for (let i = 0; i < nativeState.repeat; i++)
      await evaluate("Android.control('repeat',0)")
  }
  await evaluate(`window.auditOriginal = { tracks, receive, state };
    window.receive=()=>{}; tracks={probe:{title:'Я'.repeat(150),artist:'A'.repeat(200)}};
    lists.push({name:'Щ'.repeat(80),ids:['probe']}); $('now').close(); go('lists')`)
  try {
    assert.ok(await evaluate("$('main').scrollWidth <= $('main').clientWidth"))
    await evaluate("go('lists', lists[lists.length-1]); actions('probe')")
    assert.ok(await evaluate("$('main').scrollWidth <= $('main').clientWidth"))
    assert.ok(await evaluate("$('sheet').scrollWidth <= $('sheet').clientWidth"))
    await evaluate("$('sheet').close(); paint({...state,uri:'probe'}); $('now').showModal()")
    assert.ok(await evaluate("$('now').scrollWidth <= $('now').clientWidth"))
  } finally {
    await evaluate(`$('sheet').close(); $('now').close(); lists.pop(); tracks=auditOriginal.tracks;
      window.receive=auditOriginal.receive; go('library'); paint(auditOriginal.state); delete window.auditOriginal`)
  }
  console.log(
    'PASS: playback, pause, seek, likes, playlists, search, settings, animation, long names and end of shuffled queue',
  )
} finally {
  ws.close()
}
