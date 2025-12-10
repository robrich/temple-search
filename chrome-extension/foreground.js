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

// FRAGILE: this is all kinds of voodoo. It'll probably break.
function getCurrentUser() {
  try {
    const scripts = document.querySelectorAll('script');

    const matches = [];
    scripts.forEach((script) => {
      const text = script.textContent || '';
      const found = (text.includes('mrn') && text.includes('uuid') && text.startsWith('self.__next_f.push(') && text.endsWith(')'));
      if (found) {
        console.log(`Found`, script);
        matches.push(text);
      }
    });
    if (!matches.length) {
      console.log(`No current user script found`);
      return {};
    }

    let userScript = matches[0];
    userScript = userScript.substring('self.__next_f.push('.length);
    userStript = userScript.substring(0, userScript.length - 1);
    const arry = JSON.parse(userStript);
    if (arry.length < 2 || !arry[1].startsWith('2:')) {
      console.log(`current user script parse error`);
      return {};
    }
    const obj = JSON.parse(arry[1].substring(2));
    const cmisObj = parseObj(obj);
    if (!cmisObj) {
      console.log(`current user traverse error`);
      return {};
    }
    const user = {
      mrn: cmisObj.cmisUser?.mrn,
      uuid: cmisObj.cmisUser?.uuid,
      sex: cmisObj.cmisUser?.sex,
      phone: cmisObj.cmisUser?.phone?.localNumber,
      email: cmisObj.cmisUser?.email?.email,
      name: cmisObj.cmisUser?.nameFormats?.listPreferredSort,
      locale: cmisObj.locale
    };
    //console.log('current user', user);
    return user;
  } catch (err) {
    console.log('getCurrentUser error', err);
    return {};
  }
}

// look for the cmisUser object in the super nested tree
function parseObj(o) {
  if (!o) {
    return null;
  }
  if (o.cmisUser) {
    if (o.children) {
      delete o.children;
    }
    return o;
  }
  if (Array.isArray(o)) {
    const arr = o.map(parseObj).filter(k => k);
    if (arr.length > 1) {
      return arr;
    } else if (arr.length === 1) {
      return arr[0];
    } else {
      return null;
    }
  }
  if (typeof o === 'object' && o.children) {
    return parseObj(o.children);
  }
  return null;
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

async function getTempleNames() {
  try {
    // TODO: do we need all this post body?
    const body = {
      locale: {
        languageCode: 'ENGLISH',
        nativeLang: 'English',
        englishName: 'English',
        id: 0,
        writingSystem: {
          isoCode: 'Latn',
          nameOrder: 'GIVEN_NAME_SURNAME_SUFFIX',
          gedcomxLanguages: [
            { languageTag: 'en', languageName: null },
            { languageTag: 'de', languageName: null },
            { languageTag: 'x-Latn', languageName: null }
          ]
        },
        isoCodes: ['en', 'eng', 'Latn', 'US', 'GB'],
        isoCode: 'en'
      }
    }
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
    //if (!(json?.sessions)) {
      //console.log(`can't find sessions for ${temple.id}, ${temple.name}, ${ordinanceType}`, json);
    //}
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
  window.advSearchCurrentUser = getCurrentUser();
  const [templeGeo, templeNames] = await Promise.all([
    getTempleGeo(),
    getTempleNames()
  ]);
  const templeList = combine({templeGeo, templeNames});
  if (!templeList) {
    return; // we couldn't find something, abort
  }
  window.advSearchTempleList = templeList;
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
  const manSvg = '<svg class="adv-search-svg" version="1.0" xmlns="http://www.w3.org/2000/svg" width="20px" height="40px" viewBox="0 0 640.000000 1280.000000" preserveAspectRatio="xMidYMid meet"><g transform="translate(0.000000,1280.000000) scale(0.100000,-0.100000)" fill="#167b9c" stroke="none"><path d="M3027 12784 c-290 -52 -544 -220 -705 -463 -134 -204 -189 -425 -170 -681 30 -386 296 -743 659 -886 143 -56 212 -68 389 -69 168 0 209 6 340 47 263 83 515 309 630 562 124 273 129 581 13 856 -73 174 -231 368 -378 465 -233 154 -520 216 -778 169z"></path><path d="M1920 10435 c-8 -2 -49 -9 -90 -15 -106 -17 -265 -71 -371 -126 -394 -204 -653 -566 -731 -1024 -10 -59 -13 -445 -13 -1815 l0 -1740 22 -71 c71 -223 311 -355 546 -300 161 38 267 129 328 281 l24 60 3 1553 2 1552 110 0 110 0 2 -4152 3 -4153 21 -61 c59 -169 154 -284 295 -353 190 -93 392 -93 586 0 152 73 269 220 314 394 10 40 14 536 16 2472 l3 2423 105 0 105 0 0 -2407 c0 -2080 2 -2418 15 -2478 61 -293 341 -494 655 -471 260 18 457 165 538 401 l27 80 3 4153 2 4153 108 -3 107 -3 5 -1555 c4 -1101 8 -1564 16 -1585 75 -204 232 -315 447 -315 234 0 413 158 447 395 8 58 10 541 8 1770 -3 1588 -5 1696 -22 1785 -110 572 -500 992 -1046 1128 l-105 26 -1290 2 c-709 1 -1297 1 -1305 -1z"></path></g></svg>';
  const womanSvg = '<svg class="adv-search-svg" version="1.0" xmlns="http://www.w3.org/2000/svg" width="20px" height="40px" viewBox="0 0 640.000000 1280.000000" preserveAspectRatio="xMidYMid meet" ><g transform="translate(0.000000,1280.000000) scale(0.100000,-0.100000)" fill="#167b9c" stroke="none" ><path d="M3040 12786 c-438 -78 -765 -396 -854 -829 -19 -91 -22 -272 -6 -369 54 -340 298 -652 613 -785 165 -69 212 -78 417 -77 172 0 191 2 275 28 183 55 326 139 453 265 363 359 413 913 121 1337 -59 85 -180 204 -268 264 -92 62 -217 118 -329 146 -120 32 -309 40 -422 20z"></path ><path d="M2285 10435 c-293 -47 -542 -177 -751 -391 -178 -183 -280 -362 -367 -649 -30 -99 -115 -376 -187 -615 -73 -239 -181 -595 -240 -790 -59 -195 -167 -551 -240 -790 -72 -239 -150 -493 -172 -563 -71 -230 -81 -315 -53 -436 31 -130 117 -235 240 -293 118 -55 278 -49 385 14 49 29 126 105 160 158 38 59 54 104 149 425 419 1413 673 2267 707 2383 l25 82 110 0 c101 0 110 -2 105 -17 -10 -33 -122 -421 -326 -1128 -213 -738 -430 -1494 -660 -2290 -76 -264 -200 -693 -275 -954 -75 -260 -139 -480 -142 -487 -4 -12 100 -14 656 -14 l661 0 0 -1818 c0 -1263 3 -1836 11 -1878 43 -236 262 -398 514 -381 226 16 400 159 444 365 8 38 11 568 11 1892 l0 1840 145 0 144 0 3 -1857 c3 -1849 3 -1858 24 -1914 46 -126 117 -211 221 -267 147 -78 338 -81 484 -7 67 35 158 121 192 183 60 111 57 -5 57 2004 l0 1838 660 0 c368 0 660 4 660 9 0 4 -13 53 -29 107 -29 98 -99 339 -291 999 -169 582 -589 2029 -790 2720 -106 363 -218 749 -249 858 l-58 197 119 0 c86 0 120 -3 123 -12 2 -7 53 -179 114 -383 60 -203 168 -566 239 -805 72 -239 198 -664 282 -945 83 -280 165 -551 181 -602 35 -106 86 -190 153 -251 218 -200 568 -106 675 182 27 73 37 192 22 271 -6 33 -140 483 -297 1000 -717 2356 -657 2168 -740 2308 -185 308 -476 551 -779 651 -190 63 -140 60 -1085 62 -670 2 -883 0 -945 -11z"></path ></g ></svg>';
  const root = document.createElement('div');
  root.classList.add('clearfix');
  root.classList.add('adv-search');
  root.innerHTML = '<div class="col-lg-8 col-lg-offset-2 col-md-8 col-md-offset-2 col-sm-offset-1 col-sm-10 col-xs-12"><div class="adv-search-query"><form class="form-inline adv-search-form"><select class="eden-button eden-button--secondary adv-search-ordinance" required><option value="">Ordinance</option><option value="PROXY_BAPTISM">Proxy Baptism</option><option value="PROXY_INITIATORY">Proxy Initiatory</option><option value="PROXY_ENDOWMENT">Proxy Endowment</option><option value="PROXY_SEALING">Proxy Sealing</option></select><input required type="date" placeholder="select a date" class="eden-button eden-button--secondary adv-search-date" />'+manSvg+'<input type="number" class="eden-button eden-button--secondary adv-search-men" value="0" required min="0" max="25" />'+womanSvg+'<input type="number" class="eden-button eden-button--secondary adv-search-women" value="0" required min="0" max="25" /><button type="submit" class="eden-button eden-button--primary adv-search-submit">Search Across Temples</button></form></div><div class="adv-search-results"></div></div>';
  // TODO: set men or women to 1 if current user sex is set?
  // TODO: set both to 1 if current user's marriage is set?
  parent.parentNode.insertBefore(root, parent);
  document.querySelector('.adv-search-form').addEventListener('submit', doSearch);
}

async function doSearch(e) {
  e.preventDefault();
  const templeList = window.advSearchTempleList;
  if (!(templeList?.length)) {
    console.log(`can't search through zero temples`);
    return; // abort
  }
  const ordinanceType = document.querySelector('.adv-search-ordinance').value;
  const date = document.querySelector('.adv-search-date').value;
  let menSeats = parseInt(document.querySelector('.adv-search-men').value, 10);
  let womenSeats = parseInt(document.querySelector('.adv-search-women').value, 10);
  if (Number.isNaN(menSeats) || menSeats < 1) {
    menSeats = 0;
  }
  if (Number.isNaN(womenSeats) || womenSeats < 1) {
    womenSeats = 0;
  }
  if (!ordinanceType || !date || menSeats + womenSeats < 1) {
    alert('please select an ordinance, a date, and at least one person');
    return;
  }
  // remove event handlers to previous results' links
  document.querySelectorAll('.adv-search-link').forEach(link => {
    link.removeEventListener('click', bookAppointment);
  });

  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid"><tr><td>Loading ...</td></tr></table>';
  const currentTempleId = getCurrentTempleId();
  const templeDistance = getDistances({currentTempleId, templeList});
  const templeShortList = templeDistance
    .slice(0, TEMPLE_SEARCH_COUNT)
    .filter(t => t.distance < TEMPLE_SEARCH_DISTANCE);
  //console.log('adv-searching...', ordinanceType, date, currentTempleId);
  const schedules = await getSchedules({templeList: templeShortList, ordinanceType, date});
  //console.log('adv-search schedules', schedules);

  const hasUser = window.advSearchCurrentUser?.mrn;

  // This is the very definition of XSS
  const results = schedules.map(s => {
    s.sessions.forEach(ss => seatAvailableCount({ordinanceType, session: ss, womenSeats, menSeats}));
    const sessionTimes = s.sessions.length === 0
      ? '<span class="adv-search-full">No appointments today</span>'
      : s.sessions.map(ss => ss.canFit && hasUser
        ? `<span class="adv-search-available"><a class="adv-search-link" data-temple="{&quot;i&quot;:${ss.appointmentTimeId}, &quot;t&quot;:${ss.templeOrgId}, &quot;o&quot;:&quot;${ss.appointmentType}&quot;, &quot;d&quot;:&quot;${ss.time}&quot;}" href="#">${formatTime(ss.time)}</a> (${ordinanceType === 'PROXY_INITIATORY' ? `M: ${ss.seatAvailMale}, F: ${ss.seatAvailFemale}` : ss.seatAvailCount})</span>`
        : `<span class="${ss.canFit ? 'adv-search-available' : 'adv-search-full'}">${formatTime(ss.time)} (${ordinanceType === 'PROXY_INITIATORY' ? `M: ${ss.seatAvailMale}, F: ${ss.seatAvailFemale}` : ss.seatAvailCount})</span>`).join(', ');
    return `<tr><td class="adv-search-no-wrap">${s.name}</td><td>${sessionTimes}</td></tr>`;
  });
  document.querySelector('.adv-search-results').innerHTML = '<table class="adv-search-grid">'+results.join('')+'</table>';
  document.querySelectorAll('.adv-search-link').forEach(link => {
    link.addEventListener('click', bookAppointment);
  });
};

async function bookAppointment(e) {
  e.preventDefault();
  const el = e.currentTarget || e.target;
  const dataStr = el.getAttribute('data-temple') || el.dataset?.temple;
  let appt = null;
  try {
    appt = JSON.parse(dataStr) ?? {};
  } catch (err) {
    console.log('failed to parse data-temple', err, dataStr);
    alert('Unable to read booking data. Please click the select this temple button above.');
    return;
  }
  el.textContent = 'Booking ...';

  const user = window.advSearchCurrentUser;
  if (!user?.mrn) {
    alert('Unable to determine current user. Please click the select this temple button above.');
  }

  // i (appointmentTimeId), t (temple id), o (ordinance), d (time ISO)
  const appointmentTimeId = appt.i;
  const templeId = appt.t;
  const ordinance = appt.o;
  const timeISO = appt.d;
  if (!templeId || !ordinance || !timeISO) {
    console.log('missing booking data', appt);
    alert('Incomplete booking data. Please click the select this temple button above.');
    return;
  }
  let menSeats = parseInt(document.querySelector('.adv-search-men').value, 10);
  let womenSeats = parseInt(document.querySelector('.adv-search-women').value, 10);
  if (Number.isNaN(menSeats) || menSeats < 1) {
    menSeats = 0;
  }
  if (Number.isNaN(womenSeats) || womenSeats < 1) {
    womenSeats = 0;
  }
  if (menSeats + womenSeats < 1) {
    alert('please select at least one person');
    return;
  }
  const now = new Date().toISOString(); // "2025-12-10T00:28:30.000Z"

  // wow this is heavy
  const body = {
    appointmentDto: {
      id: null,
      appointmentStatus: null,
      appointmentSource: 'WEB',
      actionSource: 'WEB',
      appointmentType: ordinance,
      appointmentTimeId: appointmentTimeId,
      previousAppointmentTimeId: null,
      appointmentDateTime: timeISO,
      appointmentTime: formatTime(timeISO),
      needsLangAsst: false,
      templeOrgId: templeId,
      details: {
        createdDate: now,
        createdBy: user.mrn,
        updatedBy: user.mrn,
        updatedDate: now,
        malePatronCount: menSeats,
        femalePatronCount: womenSeats,
        contactMrn: user.mrn,
        contactName: user.name,
        contactInfo: user.phone,
        contactEmail: user.email,
        groupName: user.name,
        sealingType: null,
        toBeSealedType: 'NONE',
        childParentSealing: false,
        arrivalTime: null,
        sessionLength: ordinance === 'PROXY_BAPTISM' || ordinance === 'PROXY_INITIATORY' ? 30 : null,
        type: 'proxy',
        guestCount: menSeats + womenSeats,
        veilCeremonyType: 'NONE',
        needsTempleEscort: false,
        needsPriesthoodAssistance: false,
        marriageCertificateLanguage: 'ENGLISH',
        relatedInitiatoryApptId: null
      },
      createdBy: user.mrn,
      createdDate: now,
      updatedBy: user.mrn,
      updatedDate: now,
      sessionLanguage: null,
      guestList: [
        {
          guestMrn: user.mrn,
          name: user.name,
          gender: user.sex === 'M' ? 'MALE' : 'FEMALE',
          appointmentGuestAction: 'ADD',
          contactInfo: user.phone,
          email: user.email,
          createdDate: now,
          createdBy: user.mrn,
          updatedBy: user.mrn,
          updatedDate: now,
          guestSmsConfirmationFlg: false,
          guestEmailConfirmationFlg: true
        }
      ],
      patronList: [],
      groupAppointment: null,
      modifiedByTemple: false,
      onlineEligibleFlag: null,
      reviewed: false,
      scheduleReportPrinted: false,
      sloqEndowmentId: null,
      sloqSealingSpouseId: null,
      sloqSealingChildrenId: null,
      contactEmailConfirmation: true,
      userIsScheduler: true,
      userInGuestList: true,
      userSpouseInGuestList: false,
      contactSmsConfirmation: false
    },
    uuid: user.uuid,
    isGuestConfirmation: false,
    mrn: user.mrn
  };

  const res = await fetch(TEMPLE_DOMAIN+'/api/temples/appointments/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  var json = await res.json();
  //console.log('appointment booked', json);
  if (json?.id && json?.valid) {
    alert(`Appointment successfully booked. Please check your email for confirmation.`);
    window.location.reload();
    return;
  } else {
    var validationErrors = json?.validationErrors?.map(ve => ve.failedReason).join(', ') || 'unknown error';
    alert(`Appointment booking failed: ${validationErrors}. Please try booking less patrons or click the select this temple button above.`);
    console.log('appointment booking failed', json);
  }
}

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

function seatAvailableCount({ordinanceType, session, womenSeats, menSeats}) {
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

  switch (ordinanceType) {
    case 'PROXY_INITIATORY':
      session.canFit = session.seatAvailFemale >= womenSeats && session.seatAvailMale >= menSeats;
      break;
    default:
      session.canFit = session.seatAvailCount >= (womenSeats + menSeats);
      break;
  }
}
