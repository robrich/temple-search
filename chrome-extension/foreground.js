console.log('advanced temple search plugin running');

const TEMPLE_DOMAIN = 'https://tosr.churchofjesuschrist.org';
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
  const btn = document.querySelector('.temple-buttons-container');
  if (!btn) {
    await sleep(10);
    window.requestAnimationFrame(waitUntilLoaded);
  } else {
    main();
  }
}

async function getTempleNames() {
  try {
    // TODO: do we need all this post body?
    const body = {'locale':{'languageCode':'ENGLISH','nativeLang':'English','englishName':'English','id':0,'writingSystem':{'isoCode':'Latn','nameOrder':'GIVEN_NAME_SURNAME_SUFFIX','gedcomxLanguages':[{'languageTag':'en','languageName':null},{'languageTag':'de','languageName':null},{'languageTag':'x-Latn','languageName':null}]},'isoCodes':['en','eng','Latn','US','GB'],'isoCode':'en'}}
    const res = await fetch('https://tosr.churchofjesuschrist.org/api/languages', {
      'body': JSON.stringify(body),
      'method': 'POST'
    });
    const js = await res.text();
    const json = js.replace('tisfBundle = ', '').replace(/;$/, '');
    const tisfBundle = JSON.parse(json);
    if (!(tisfBundle?.messages)) {
      console.log(`can't find temple list`);
      return null;
    }
    const temples = Object.entries(tisfBundle.messages).map(([key, value]) => {
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

async function getTempleGeo() {
  await sleep(0);
  // thanks https://churchofjesuschristtemples.org/maps/downloads/
  // injected temple-geo.js
  return templeGeo;
}

function getCurrentTempleId() {
  let templeId = null;
  try {
    const currentTempleOrgId = localStorage?.getItem('currentTempleOrgId') || window?.localStorage?.currentTempleOrgId;
    if (currentTempleOrgId) {
      templeId = parseInt(currentTempleOrgId, 10);
      if (Number.isNaN(templeId) || templeId < 1) {
        templeId = null;
      }
    }
  } catch (err) {
    console.log('localStorage access error', err);
  }
  if (!templeId) {
    templeId = 75530; // default to Draper
  }
  return templeId;
}

function combine({templeGeo, templeNames}) {
  if (!(templeGeo?.length) || !(templeNames?.length)) {
    console.log('missing data', templeGeo?.length, templeNames?.length);
    return null;
  }
  const templeList = templeNames
    .map(temple => {
      const geo = templeGeo.find(t => t.id === temple.id);
      //if (!geo) {
        //console.log('missing geo', temple);
      //}
      return {
        id: temple.id,
        name: temple.name,
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

// convert '2025-03-15' local midnight to '2025-03-15T06:00:00.000Z' UTC
function localDateToUTCISO(localDateStr) {
  const localDate = new Date(localDateStr); // local midnight
  const offsetMs = localDate.getTimezoneOffset() * 60 * 1000; // offset in milliseconds
  const utcDate = new Date(localDate.getTime() - offsetMs);
  return utcDate.toISOString();
}

async function getSchedule({temple, ordinanceType, date}) {
  try {
    const body = {
      startDate: `${date}T22:00:00.000Z`, // FRAGILE: why late in the day on the current day?
      gender: 'MALE', // TODO: how to find this?
      actionSource: 'WEB',
      inclSpouse: true,
      onlineAvailabilityOnly: true,
      excludePatronList: true,
      appointmentTypes: [ordinanceType],
      templeOrgId: temple.id,
      isGuestConfirmation: false
    };
    const res = await fetch(TEMPLE_DOMAIN+'/api/temples/appointment/sessions/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!(json?.sessions)) {
      console.log(`can't find sessions for ${temple.id}, ${temple.name}, ${ordinanceType}`, json);
    }
    return {
      id: temple.id,
      name: temple.name,
      ordinanceType,
      sessions: json?.sessions ?? []
    };
  } catch (err) {
    console.log(`schedule fetch error for ${temple.id}, ${temple.name}, ${ordinanceType}`, err);
    return {
      id: temple.id,
      name: temple.name,
      ordinanceType,
      sessions: json?.sessions ?? []
    };
  }
}

async function getSchedules({templeList, ordinanceType, date}) {
  return Promise.all(templeList.map(t => getSchedule({temple: t, ordinanceType, date})));
}

async function main() {
  const [templeGeo, templeNames] = await Promise.all([
    getTempleGeo(),
    getTempleNames()
  ]);
  const templeList = combine({templeGeo, templeNames});
  if (!templeList) {
    return; // we couldn't find something, abort
  }
  window.templeList = templeList;
  console.log(`loaded ${templeList.length} temples`);
  initUI();
  if (window?.navigation?.addEventListener) {
    window.navigation.addEventListener('navigate', initUI);
  }
}

function initUI() {
  const search = document.querySelector('.adv-search-ordinance');
  if (search) {
    console.log('adv-search already setup');
    return;
  }
  const parent = document.querySelector('.appointments-container');
  if (!parent) {
    console.log(`can't find dom node to build adv-search`);
    return; // can't find it
  }
  const root = document.createElement('div');
  root.classList.add('clearfix');
  root.classList.add('adv-search');
  root.innerHTML = '<div class="col-lg-8 col-lg-offset-2 col-md-8 col-md-offset-2 col-sm-offset-1 col-sm-10 col-xs-12"><div class="adv-search-query"><form class="form-inline adv-search-form"><select class="eden-button eden-button--secondary adv-search-ordinance" required><option value="">Ordinance</option><option value="PROXY_BAPTISM">Proxy Baptism</option><option value="PROXY_INITIATORY">Proxy Initiatory</option><option value="PROXY_ENDOWMENT">Proxy Endowment</option><option value="PROXY_SEALING">Proxy Sealing</option></select><input required type="date" placeholder="select a date" class="eden-button eden-button--secondary adv-search-date" /><button type="submit" class="eden-button eden-button--primary adv-search-submit">Search Across Temples</form></div><div class="adv-search-results"></div></div>';
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
  const date = document.querySelector('.adv-search-date').value;
  if (!ordinanceType || !date) {
    alert('please select an ordinance and date');
    return;
  }
  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid"><tr><td>Loading ...</td></tr></table>';
  const currentTempleId = getCurrentTempleId();
  const templeDistance = getDistances({currentTempleId, templeList});
  const templeShortList = templeDistance
    .slice(0, TEMPLE_SEARCH_COUNT)
    .filter(t => t.distance < TEMPLE_SEARCH_DISTANCE);
  //console.log('adv-searching...', ordinanceType, date, currentTempleId);
  const schedules = await getSchedules({templeList: templeShortList, ordinanceType, date});
  //console.log('adv-search schedules', schedules);

  // This is the very definition of XSS
  const results = schedules.map(s => {
    s.sessions.forEach(ss => seatAvailableCount(ordinanceType, ss));
    const sessionTimes = s.sessions.length === 0
      ? '<span class="adv-search-full">No appointments today</span>'
      : s.sessions.map(ss => `<span class="${ss.seatAvailCount > 0 ? 'adv-search-available' : 'adv-search-full'}">${formatTime(ss.time)} (${ordinanceType === 'PROXY_INITIATORY' ? `M: ${ss.seatAvailMale}, F: ${ss.seatAvailFemale}` : ss.seatAvailCount})</span>`).join(', ');
    return `<tr><td class="adv-search-no-wrap">${s.name}</td><td>${sessionTimes}</td></tr>`;
  });
  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid">'+results.join('')+'</table>';
};

function formatTime(source) {
  if (!source) {
    return '-';
  }
  var date = new Date(source);
  const hour24 = date.getHours();
  const minute = date.getMinutes();
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function seatAvailableCount(ordinanceType, session) {
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
