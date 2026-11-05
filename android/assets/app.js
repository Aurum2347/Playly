'use strict'
const $ = (id) => document.getElementById(id)
const paths = {
  settings:
    'M4 7h9m5 0h2M4 17h2m5 0h9 M17 7a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M10 17a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
  library: 'M4 4v16m5-16v16m5-15 5 14',
  heart:
    'M12 20S3 14.4 3 8.7C3 3.4 9.2 2.6 12 7c2.8-4.4 9-3.6 9 1.7C21 14.4 12 20 12 20Z',
  lists: 'M3 5h15M3 11h11M3 17h7m7-4v8m-4-4h8',
  plus: 'M12 5v14M5 12h14',
  search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 1 1 16 0',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 5v14m8-14v14',
  next: 'm5 5 10 7-10 7z M18 5v14',
  prev: 'm19 5-10 7 10 7z M6 5v14',
  more: 'M4 12h1m6 0h1m6 0h1',
  down: 'm5 9 7 7 7-7',
  shuffle:
    'M3 6h3c5 0 7 12 12 12h3m-3-3 3 3-3 3M3 18h3c2 0 3-1 4-3m4-7c1-1 2-2 4-2h3m-3-3 3 3-3 3',
  repeat:
    'm16 2 4 4-4 4M4 12V9a3 3 0 0 1 3-3h13M8 22l-4-4 4-4m12-2v3a3 3 0 0 1-3 3H4',
}
function icon(el, name) {
  if (el.dataset.drawn === name) return
  el.dataset.drawn = name
  el.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' +
    paths[name] +
    '"/></svg>'
}
document
  .querySelectorAll('[data-icon]')
  .forEach((el) => icon(el, el.dataset.icon))
function node(tag, cls, text) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text) el.textContent = text
  return el
}
function button(text, action, cls = 'wide') {
  const el = node('button', cls, text)
  el.onclick = action
  return el
}
function art(track) {
  const cover = node('span', 'art')
  cover.setAttribute('aria-hidden', 'true')
  if (track?.cover) {
    const img = node('img')
    img.alt = ''
    img.src = '/cover/' + encodeURIComponent(track.cover)
    cover.append(img)
  }
  return cover
}
const read = (key, initial) =>
  JSON.parse(localStorage.getItem(key) || JSON.stringify(initial))
const likes = new Set(read('likes', [])),
  lists = read('lists', [])
let tracks = {},
  page = 'library',
  list = null,
  state = {},
  update = false,
  dragging = false,
  displayed = ''
const saveLists = () => localStorage.setItem('lists', JSON.stringify(lists))
function visible() {
  const ids = list
    ? list.ids
    : Object.keys(tracks).sort((a, b) => tracks[b].added - tracks[a].added)
  const q = $('search').value.trim().toLocaleLowerCase()
  return ids.filter(
    (id) =>
      tracks[id] &&
      (page !== 'likes' || likes.has(id)) &&
      (tracks[id].title + ' ' + (tracks[id].artist || ''))
        .toLocaleLowerCase()
        .includes(q),
  )
}
function favorite(id) {
  if (likes.has(id)) likes.delete(id)
  else likes.add(id)
  localStorage.setItem('likes', JSON.stringify([...likes]))
  $('npLike').setAttribute('aria-pressed', likes.has(state.uri))
  render()
}
function sheet(title, ...items) {
  $('sheetBody').replaceChildren(node('h2', '', title), ...items)
  if (!$('sheet').open) $('sheet').showModal()
}
function newList(id) {
  const field = node('input')
  field.placeholder = 'Название плейлиста'
  field.maxLength = 80
  field.setAttribute('aria-label', field.placeholder)
  const create = () => {
    const name = field.value.trim()
    if (!name) {
      field.focus()
      return
    }
    lists.push({ name, ids: id ? [id] : [] })
    saveLists()
    $('sheet').close()
    render()
  }
  field.onkeydown = (e) => {
    if (e.key === 'Enter') create()
  }
  sheet('Новый плейлист', field, button('Создать', create, 'primary'))
  field.focus()
}
function actions(id) {
  const options = [
    button(likes.has(id) ? 'Убрать из любимого' : 'Добавить в любимое', () => {
      favorite(id)
      $('sheet').close()
    }),
    button('Добавить в плейлист', () =>
      sheet(
        'Выберите плейлист',
        ...lists.map((l) =>
          button(l.name, () => {
            if (!l.ids.includes(id)) l.ids.push(id)
            saveLists()
            $('sheet').close()
            render()
          }),
        ),
        button('Новый плейлист', () => newList(id), 'secondary'),
      ),
    ),
  ]
  if (list)
    options.push(
      button('Убрать из плейлиста', () => {
        list.ids = list.ids.filter((v) => v !== id)
        saveLists()
        $('sheet').close()
        render()
      }),
    )
  options.push(
    button('Убрать из медиатеки', () =>
      sheet(
        'Убрать трек из медиатеки?',
        node('p', '', 'Аудиофайл останется на устройстве.'),
        button(
          'Убрать',
          () => {
            Android.forget(id)
            $('sheet').close()
          },
          'primary',
        ),
      ),
    ),
  )
  sheet(tracks[id].title, ...options)
}
function empty(title, description, action, label) {
  const el = node('div', 'empty')
  el.append(art(), node('h2', '', title), node('p', '', description))
  if (action) el.append(button(label, action, 'primary'))
  return el
}
function go(next, playlist = null) {
  page = next
  list = playlist
  $('search').value = ''
  $('main').scrollTop = 0
  render()
  $('content').classList.remove('enter')
  void $('content').offsetHeight
  $('content').classList.add('enter')
}
function render() {
  const overview = page === 'lists' && !list
  $('heading').textContent =
    list?.name ||
    { library: 'Моя музыка', likes: 'Любимое', lists: 'Плейлисты' }[page]
  $('filter').hidden = overview
  $('add').hidden = page === 'likes'
  icon($('add'), list ? 'more' : 'plus')
  $('add').setAttribute(
    'aria-label',
    list
      ? 'Настройки плейлиста'
      : overview
        ? 'Создать плейлист'
        : 'Добавить музыку',
  )
  $('add').onclick = list
    ? () => {
        const field = node('input')
        field.value = list.name
        field.maxLength = 80
        field.setAttribute('aria-label', 'Название плейлиста')
        sheet(
          'Плейлист',
          field,
          button('Сохранить название', () => {
            if (!field.value.trim()) {
              field.focus()
              return
            }
            list.name = field.value.trim()
            saveLists()
            $('sheet').close()
            render()
          }),
          button('Удалить плейлист', () =>
            sheet(
              'Удалить плейлист?',
              node('p', '', 'Треки останутся в медиатеке.'),
              button(
                'Удалить',
                () => {
                  lists.splice(lists.indexOf(list), 1)
                  saveLists()
                  $('sheet').close()
                  go('lists')
                },
                'primary',
              ),
            ),
          ),
        )
      }
    : overview
      ? () => newList()
      : () => Android.pick()
  document
    .querySelectorAll('nav button')
    .forEach((el) =>
      el.setAttribute(
        'aria-current',
        el.dataset.page === page ? 'page' : 'false',
      ),
    )
  const box = $('content')
  box.replaceChildren()
  if (overview) {
    for (const l of lists)
      box.append(button(l.name + ' · ' + l.ids.length, () => go('lists', l)))
    if (!lists.length)
      box.append(
        empty(
          'Своя подборка',
          'Соберите треки для дороги, работы или вечера.',
          () => newList(),
          'Создать плейлист',
        ),
      )
    return
  }
  const ids = visible()
  if (!ids.length) {
    if ($('search').value)
      box.append(
        empty(
          'Ничего не найдено',
          'Попробуйте другое название или имя артиста.',
        ),
      )
    else if (list)
      box.append(
        empty(
          'Пока пусто',
          'Откройте меню трека в медиатеке и добавьте его сюда.',
          () => go('library'),
          'К музыке',
        ),
      )
    else if (page === 'likes')
      box.append(
        empty(
          'Любимые треки',
          'Нажмите на сердце в плеере, чтобы сохранить трек здесь.',
          () => go('library'),
          'К музыке',
        ),
      )
    else
      box.append(
        empty(
          'Музыка с устройства',
          'Выберите аудиофайлы, чтобы слушать их в Playly офлайн.',
          () => Android.pick(),
          'Добавить музыку',
        ),
      )
  }
  const frag = document.createDocumentFragment()
  for (const id of ids) {
    const t = tracks[id],
      row = node('div', 'row' + (id === state.uri ? ' current' : ''))
    row.dataset.id = id
    const play = button(
        '',
        () => Android.play(id, JSON.stringify(ids)),
        'track',
      ),
      names = node('span', 'names')
    names.append(
      node('b', '', t.title),
      node('small', '', t.artist || 'Без исполнителя'),
    )
    play.append(art(t), names)
    const more = button('', () => actions(id), '')
    more.setAttribute('aria-label', 'Меню трека ' + t.title)
    icon(more, 'more')
    row.append(play, more)
    frag.append(row)
  }
  box.append(frag)
}
const time = (ms) =>
  Math.floor(ms / 60000) +
  ':' +
  String(Math.floor(ms / 1000) % 60).padStart(2, '0')
function paint(s) {
  state = s
  $('bigArt').classList.toggle('spinning', s.playing)
  const t = tracks[s.uri]
  $('mini').hidden = !t
  if (!t) return
  if (displayed !== s.uri) {
    displayed = s.uri
    $('miniArt').replaceChildren(art(t))
    $('bigArt').replaceChildren(art(t))
    $('miniTitle').textContent = $('npTitle').textContent = t.title
    $('miniArtist').textContent = $('npArtist').textContent =
      t.artist || 'Без исполнителя'
    $('npLike').setAttribute('aria-pressed', likes.has(s.uri))
    document
      .querySelectorAll('.row')
      .forEach((r) => r.classList.toggle('current', r.dataset.id === s.uri))
  }
  for (const b of [$('npToggle'), $('miniToggle')]) {
    icon(b, s.playing ? 'pause' : 'play')
    b.setAttribute('aria-label', s.playing ? 'Пауза' : 'Воспроизвести')
  }
  $('shuffle').setAttribute('aria-pressed', s.shuffle)
  $('repeat').setAttribute('aria-pressed', s.repeat !== 0)
  $('repeat').classList.toggle('one', s.repeat === 1)
  $('repeat').setAttribute(
    'aria-label',
    ['Повтор выключен', 'Повтор одного трека', 'Повтор очереди'][s.repeat],
  )
  $('seek').max = s.duration || 1
  if (!dragging) {
    $('seek').value = s.pos
    $('elapsed').textContent = time(s.pos)
  }
  $('duration').textContent = time(s.duration)
}
function settings() {
  const auto = button(
    'Автопроверка обновлений · ' + (Android.auto() ? 'вкл.' : 'выкл.'),
    () => {
      Android.autoCheck(!Android.auto())
      settings()
    },
  )
  auto.setAttribute('aria-pressed', Android.auto())
  sheet(
    'Настройки',
    button('Эквалайзер', () => {
      const choices = [
        'Без обработки',
        'Больше баса',
        'Вокал',
        'Высокие частоты',
      ]
      sheet(
        'Эквалайзер',
        ...choices.map((name, i) => {
          const b = button(name, () => {
            Android.control('preset', i)
            $('sheet').close()
          })
          b.setAttribute('aria-pressed', Android.preset() === i)
          return b
        }),
        button('Системный эквалайзер', () => Android.equalizer()),
      )
    }),
    auto,
    button('Проверить Android-версию', () => Android.update()),
    ...(update
      ? [button('Скачать обновление APK', () => Android.download(), 'primary')]
      : []),
  )
}
window.receive = (event, data) => {
  if (event === 'library') {
    tracks = data
    render()
  }
  if (event === 'removed') {
    likes.delete(data)
    localStorage.setItem('likes', JSON.stringify([...likes]))
    for (const l of lists) l.ids = l.ids.filter((id) => id !== data)
    saveLists()
    if (state.uri === data) {
      $('now').close()
      displayed = ''
    }
  }
  if (event === 'available' || event === 'update') {
    update = !!data
    $('settings').classList.toggle('has-update', update)
    $('settings').setAttribute(
      'aria-label',
      update ? 'Настройки · доступно обновление' : 'Настройки',
    )
    if (
      $('sheet').open &&
      $('sheetBody').querySelector('h2')?.textContent === 'Настройки'
    )
      settings()
  }
  if (event === 'state') paint(data)
}
window.back = () => {
  for (const dialog of [$('sheet'), $('now')])
    if (dialog.open) {
      dialog.close()
      return true
    }
  if (list || page !== 'library') {
    go(list ? 'lists' : 'library')
    return true
  }
  if ($('search').value) {
    $('search').value = ''
    render()
    return true
  }
  return false
}
$('closeSheet').onclick = () => $('sheet').close()
$('sheet').onclick = (e) => {
  if (
    e.target === $('sheet') &&
    e.clientY < $('sheet').getBoundingClientRect().top
  )
    $('sheet').close()
}
$('search').oninput = render
document
  .querySelectorAll('nav button')
  .forEach((el) => (el.onclick = () => go(el.dataset.page)))
$('settings').onclick = settings
$('expand').onclick = () => $('now').showModal()
$('collapse').onclick = () => $('now').close()
$('npLike').onclick = () => favorite(state.uri)
for (const [id, cmd] of Object.entries({
  miniToggle: 'toggle',
  npToggle: 'toggle',
  miniNext: 'next',
  next: 'next',
  previous: 'prev',
  shuffle: 'shuffle',
  repeat: 'repeat',
}))
  $(id).onclick = () => Android.control(cmd, 0)
$('seek').oninput = () => {
  dragging = true
  $('elapsed').textContent = time(Number($('seek').value))
}
$('seek').onchange = () => {
  dragging = false
  Android.control('seek', Number($('seek').value))
}
$('seek').onpointercancel = () => {
  dragging = false
}
render()
