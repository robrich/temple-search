console.log('advanced temple search plugin running');

const TEMPLE_DOMAIN = 'https://temple-online-scheduling.churchofjesuschrist.org';
const TEMPLE_SEARCH_COUNT = 25;
const TEMPLE_SEARCH_DISTANCE = 4.5; // 1 lat degree is 69 miles
const ORDINANCE_TYPES = [
  'PROXY_BAPTISM',
  'PROXY_INITIATORY',
  'PROXY_ENDOWMENT',
  'PROXY_SEALING'
];

waitUntilLoaded();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntilLoaded() {
  const btn = document.querySelector('.select-this-temple');
  if (!btn) {
    await sleep(10);
    window.requestAnimationFrame(waitUntilLoaded);
  } else {
    main();
  }
}

async function getTempleNames() {
  try {
    const res = await fetch(TEMPLE_DOMAIN+'/tisf/language/bundle/js/messages');
    const js = await res.text();
    const json = js.replace('tisfBundle = ', '').replace(/;$/, '');
    const tisfBundle = JSON.parse(json);
    if (!tisfBundle) {
      console.log(`can't find temple list`);
      return null;
    }
    const temples = Object.entries(tisfBundle).map(([key, value]) => {
      if (key.indexOf('temple.name.') !== 0) {
        return null;
      }
      const id = parseInt(key.replace('temple.name.', ''), 0);
      if (!id) {
        return null;
      }
      return {
        name: value,
        id: id
      };
    }).filter(k => k);
    return temples;
  } catch (err) {
    console.log('templeNames fetch error', err);
    return null;
  }
}

async function getTempleScheduling() {
  try {
    const res = await fetch(TEMPLE_DOMAIN+'/api/templeConfig/findAllOnlineSchedulingStatuses');
    const json = await res.json();
    if (!(json?.length)) {
      console.log(`can't find scheduling status`);
      return null;
    }
    return json
      .filter(j => j.onlineSchedulingAvailable)
      .map(j => j.templeOrgId);
  } catch (err) {
    console.log('templeScheduling fetch error', err);
    return null;
  }
}

async function getTempleGeo() {
  await sleep(0);
  // thanks https://churchofjesuschristtemples.org/maps/downloads/
  // injected temple-geo.js
  return templeGeo;
}

async function getCurrentTempleId() {
  try {
    const res = await fetch(TEMPLE_DOMAIN+'/api/templeInfo');
    const json = await res.json();
    if (!(json?.templeOrgId)) {
      console.log(`can't find currentTemple`);
      return null;
    }
    return json.templeOrgId;
  } catch (err) {
    console.log('currentTemple fetch error', err);
    return null;
  }
}

function combine({templeGeo, templeNames, scheduling}) {
  if (!(templeGeo?.length) || !(templeNames?.length) || !(scheduling?.length)) {
    console.log('missing data', templeGeo?.length, templeNames?.length, scheduling?.length);
    return null;
  }
  const templeList = scheduling
    .map(id => {
      const geo = templeGeo.find(t => t.id === id);
      const tName = templeNames.find(t => t.id === id);
      if (!tName) {
        console.log('missing name', id);
      }
      if (!geo) {
        console.log('missing geo', id, tName?.name);
      }
      return {
        id,
        name: tName?.name,
        lat: geo?.lat,
        long: geo?.long
      };
    })
    .filter(t => t.name && t.lat && t.long);
  return templeList;
}

function getDistances({currentTempleId, templeList}) {
  const currentTemple = templeList.find(t => t.id === currentTempleId);
  if (!currentTemple) {
    console.log(`can't find current temple in templeList`, currentTempleId);
  }
  const templeDistances = templeList.map(t => {
    const distance = Math.sqrt(
      Math.pow((t.lat - currentTemple.lat), 2) +
      Math.pow((t.long - currentTemple.long), 2)
    );
    return {...t, distance};
  });
  return templeDistances.sort((a, b) => a.distance - b.distance);
}

async function getSchedule({temple, ordinanceType, date}) {
  try {
    const body = {
      appointmentType: ordinanceType,
      isGuestConfirmation: false,
      sessionDay: date.day,
      sessionMonth: date.month,
      sessionYear: date.year,
      templeOrgId: temple.id
    };
    const res = await fetch(TEMPLE_DOMAIN+'/api/templeSchedule/getSessionInfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!(json?.hasOwnProperty('sessionList'))) {
      console.log(`can't find schedule for ${templeId},${ordinanceType}`);
      return null;
    }
    return {
      id: temple.id,
      name: temple.name,
      ordinanceType,
      sessionList: json.sessionList
    };
  } catch (err) {
    console.log(`schedule fetch error for ${templeId},${ordinanceType}`, err);
    return null;
  }
}

async function getSchedules({templeList, ordinanceType, date}) {
  return Promise.all(templeList.map(t => getSchedule({temple: t, ordinanceType, date})));
}

async function main() {
  const [templeGeo, templeNames, scheduling] = await Promise.all([
    getTempleGeo(),
    getTempleNames(),
    getTempleScheduling()
  ]);
  const templeList = combine({templeGeo, templeNames, scheduling});
  if (!templeList) {
    return; // we couldn't find something, abort
  }
  window.templeList = templeList;
  console.log(`loaded ${templeList.length} temples`);
  initUI();
  window.navigation.addEventListener('navigate', initUI);
}

function initUI() {
  const search = document.querySelector('.adv-search-ordinance');
  if (search) {
    console.log('adv-search already setup');
    return;
  }
  const div = document.querySelector('.my-appointments-title-section');
  let parent = div;
  while (parent) {
    parent = parent.parentNode;
    if (!parent) {
      break; // can't find it
    }
    if (parent.nodeName === 'TOS-ROW') {
      break;
    }
  }
  if (!parent) {
    console.log(`can't find dom node to build adv-search`);
    return; // can't find it
  }
  const root = document.createElement('div');
  root.classList.add('clearfix');
  root.classList.add('adv-search');
  root.innerHTML = '<div class="col-lg-8 col-lg-offset-2 col-md-8 col-md-offset-2 col-sm-offset-1 col-sm-10 col-xs-12"><div class="adv-search-query"><form class="form-inline adv-search-form"><select class="form-control adv-search-ordinance" required><option value="">Ordinance</option><option value="PROXY_BAPTISM">Proxy Baptism</option><option value="PROXY_INITIATORY">Proxy Initiatory</option><option value="PROXY_ENDOWMENT">Proxy Endowment</option><option value="PROXY_SEALING">Proxy Sealing</option></select><input required type="date" placeholder="select a date" class="form-control adv-search-date" /><button type="submit" class="btn btn-primary adv-search-submit">Search Across Temples</form></div><div class="adv-search-results"></div></div>';
  parent.parentNode.insertBefore(root, parent);
  document.querySelector('.adv-search-form').addEventListener('submit', doSearch);
}

async function doSearch(e) {
  e.preventDefault();
  const templeList = window.templeList;
  if (!(templeList?.length)) {
    console.log(`can't search through zero temples`);
    return; // abort
  }
  const ordinanceType = document.querySelector('.adv-search-ordinance').value;
  const dateStr = document.querySelector('.adv-search-date').value;
  if (!ordinanceType || !dateStr) {
    alert('please select an ordinance and date');
    return;
  }
  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid"><tr><td>Loading ...</td></tr></table>';
  const currentTempleId = await getCurrentTempleId();
  const templeDistance = getDistances({currentTempleId, templeList});
  const templeShortList = templeDistance
    .slice(0, TEMPLE_SEARCH_COUNT)
    .filter(t => t.distance < TEMPLE_SEARCH_DISTANCE);
  const datePieces = dateStr.split('-').map(p => parseInt(p, 10));
  const date = {
    day: datePieces[2],
    month: datePieces[1]-1,
    year: datePieces[0]
  };
  //console.log('adv-searching...', ordinanceType, date, currentTempleId);
  const schedules = await getSchedules({templeList: templeShortList, ordinanceType, date});
  // This is the very definition of XSS
  const results = schedules.map(s => {
    if (!s.sessionList) {
      s.sessionList = [];
    }
    s.sessionList.forEach(ss => seatAvailableCount(ordinanceType, ss));
    const sessionTimes = s.sessionList.length === 0
      ? '<span class="adv-search-full">No appointments today</span>'
      : s.sessionList.map(ss => `<span class="${ss.seatAvailCount > 0 ? 'adv-search-available' : 'adv-search-full'}">${formatTime(ss.sessionTime)} (${ordinanceType === 'PROXY_INITIATORY' ? `M: ${ss.seatAvailMale}, F: ${ss.seatAvailFemale}` : ss.seatAvailCount})</span>`).join(', ');
    return `<tr><td class="adv-search-no-wrap">${s.name}</td><td>${sessionTimes}</td></tr>`;
  });
  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid">'+results.join('')+'</table>';
  //console.log('adv-search results', schedules);
};

function formatTime(source) {
  if (!source) {
    return '-';
  }
  const pieces = source.split(':').map(p => parseInt(p, 10));
  if (pieces.length !== 2) {
    return source;
  }
  const hour = pieces[0];
  const minute = pieces[1];
  let result = `${(hour > 12 ? hour - 12 : hour)}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  return result;
}

function seatAvailableCount(ordinanceType, session) {
  //return session.results?.seatsAvailable ?? 0;

  let maleHold = 0;
  let femaleHold = 0;
  switch (ordinanceType) {
    case 'PROXY_BAPTISM':
    case 'PROXY_SEALING':
      maleHold = session.details?.malePatronCount ?? 0,
      femaleHold = session.details.femalePatronCount ?? 0;
      break;
    case 'PROXY_ENDOWMENT':
    case 'PROXY_INITIATORY':
      femaleHold = session.additionalFemaleGuestCount ?? 0;
      maleHold = session.additionalMaleGuestCount ?? 0;
      break;
  }

  let available = 0;
  switch (ordinanceType) {
    case 'PROXY_INITIATORY':
      // TODO: prompt for gender
      available = session.details?.maleSeatsAvailable ?? 0
        + session.details.femaleSeatsAvailable ?? 0;
      session.seatAvailMale = session.details?.maleSeatsAvailable ?? 0;
      session.seatAvailFemale = session.details?.femaleSeatsAvailable ?? 0;
      break;
    case 'PROXY_ENDOWMENT':
      available = session.details?.remainingOnlineSeatsAvailable ?? 0;
      break;
    case 'PROXY_BAPTISM':
    case 'PROXY_SEALING':
      available = session.details?.seatsAvailable ?? 0;
      break;
  }
  const hold = maleHold + femaleHold;
  //console.log(`${session.sessionTime}: avail: ${available}, hold: ${hold}`);

  session.seatAvailCount = available - hold;
}
