const DialogflowApp = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const requestPromise = require('request-promise');
const dateFormat = require('dateformat');
const stringUtil = require('string');
const htmlToText = require('html-to-text');
const i18n = require('i18n');

const WELCOME_MEETUP_INTENT = 'welcome-meetup';
const BYE_MEETUP_INTENT = 'bye-meetup';
const ASK_MEETUP_INTENT = 'ask-meetup';
const SEARCH_MEETUP_INTENT = 'search-meetup';
const MEETUP_SELECTED_INTENT = 'meetup-selected';
const CONFIRMATION_RSVP_YES_INTENT = 'confirmation-rsvp-yes';
const CONFIRMATION_EVENT_NO_INTENT = 'confirmation-event-no';
const CONFIRMATION_RSVP_NO_INTENT = 'confirmation-rsvp-no';
const FIND_NEXT_EVENT_INTENT = 'find-next-event';

const CONTEXT_MEETUP = "context-meetup";
const CONTEXT_EVENT = "context-event";

const MEETUP_API_KEY = () => process.env.MEETUP_API_KEY;

const URL_FIND_NEXT_MEETUP = 'https://api.meetup.com/{{name}}/events?&sign=true&photo-host=public&page=1';
const URL_SEARCH_MEETUP = 'https://api.meetup.com/find/groups?&key={{key}}&sign=true&photo-host=public&location={{location}}&text={{type}}';
const URL_RSVP_MEETUP = 'https://api.meetup.com/2/rsvp/';

const DEFAULT_IMAGE = "https://raw.githubusercontent.com/xavmarc/assistant-meetup/master/images/default-meetup.png";
const DEFAULT_RSVP = "https://raw.githubusercontent.com/xavmarc/assistant-meetup/master/images/rsvp-meetup.jpg";

const NAME = "name";
const TYPE = "type";
const CITY = "city";
const ID = "id";

const RED_COLOR = "#ff0000";

exports.meetupagent = functions.https.onRequest((req, res) => {
  let app = new DialogflowApp({ request: req, response: res });

  i18n.configure({
    locales: ['en-US', 'fr-FR'],
    directory: __dirname + '/locales',
    defaultLocale: 'en-US'
  });

  if (app.getUserLocale()) {
    i18n.setLocale(app.getUserLocale());
  }

  requestSource = (req.body.originalRequest) ? req.body.originalRequest.source : undefined;

  function byeMeetup() {
    if (requestSource === "google") {
      app.tell({
        speech: i18n.__("BYE"),
        displayText: i18n.__("BYE")
      });
    } else {
      let slackData = {
        text: i18n.__("BYE"),
        data: []
      };
      buildSlackMessage(res, i18n.__("BYE"), slackData);
    }
  }

  function welcomeMeetup() {
    if (requestSource === "google") {
      if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
        app.ask(app.buildRichResponse()
          .addSimpleResponse({
            speech: i18n.__("HELLO"),
            displayText: i18n.__("HELLO")
          })
          .addSimpleResponse({
            speech: i18n.__("HELP"),
            displayText: i18n.__("HELP")
          }));
      } else {
        app.ask("<speak>" + i18n.__("HELP") + i18n.__("HELP") + "</speak>");
      }
    } else {
      let slackData = [
        {
          title: "",
          text: i18n.__("DESCRIPTION"),
          image_url: DEFAULT_IMAGE,
          color: RED_COLOR
        }
      ];
      buildSlackMessage(res, i18n.__("HELLO"), slackData);
    }
  }

  function askMeetup() {
    if (requestSource === "google") {
      app.ask({
        speech: i18n.__("DESCRIPTION"),
        displayText: i18n.__("DESCRIPTION")
      });
    } else {
      buildSlackMessage(res, i18n.__("DESCRIPTION"), []);
    }
  }

  function findNextEvent() {
    let name = "";
    if (requestSource === "google") {
      name = app.getArgument(NAME);
    } else {
      let context = req.body.result.contexts.find(context => {
        return context.name == CONTEXT_MEETUP
      });
      name = context.parameters.name;
    }
    requestPromise(stringUtil(URL_FIND_NEXT_MEETUP)
      .template({ "name": name }).s, { resolveWithFullResponse: true })
      .then(
        response => {
          if (response.statusCode === 200) {
            let data = JSON.parse(response.body);
            if (requestSource === "google") {
              if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
                if (data[0]) {
                  let parameters = {};
                  parameters["id"] = data[0].id;
                  parameters["name"] = data[0].group.urlname;
                  app.setContext(CONTEXT_EVENT, 5, parameters);
                  app.ask(buildCardEvent(app, data[0]));
                } else {
                  app.ask({
                    speech: i18n.__("NO_FUTUR_EVENT"),
                    displayText: i18n.__("NO_FUTUR_EVENT")
                  });
                }
              } else {
                if (data[0]) {
                  let venue = "";
                  if (data[0].venue) {
                    venue = i18n.__("VENUE", data[0].venue.name, data[0].venue.address_1, data[0].venue.city);
                  }
                  app.ask("<speak>" + i18n.__("NEXT_EVENT", data[0].group.name, data[0].name)
                    + i18n.__("NEXT_DATE_EVENT", dateFormat(new Date(data[0].time), "dd/mm/yyyy HH:MM"), venue) + "</speak>");
                } else {
                  app.ask("<speak>" + i18n.__("NO_FUTUR_EVENT") + "</speak>");
                }
              }
            } else {
              if (data[0]) {
                let venue = "";
                if (data[0].venue) {
                  venue = i18n.__("VENUE", data[0].venue.name, data[0].venue.address_1, data[0].venue.city);
                }
                let slackData = [
                  {
                    title: i18n.__("NEXT_EVENT", data[0].group.name, data[0].name),
                    text: i18n.__("NEXT_DATE_EVENT", dateFormat(new Date(data[0].time), "dd/mm/yyyy HH:MM"), venue),
                    image_url: DEFAULT_RSVP,
                    color: RED_COLOR
                  }
                ];
                parameters["id"] = data[0].id;
                parameters["name"] = data[0].group.urlname;
                let context = res.contexts.find(context => {
                  return context.name == CONTEXT_EVENT
                }) 
                if (context != undefined) {
                  context = { name: CONTEXT_EVENT, parameters: parameters, lifespan: 5 };
                } else {
                  res.contexts.append({ name: CONTEXT_EVENT, parameters: parameters, lifespan: 5 });
                }
                buildSlackMessage(res, i18n.__("FOUND", data[0].name), slackData);
              } else {
                buildSlackMessage(res, i18n.__("NO_FUTUR_EVENT", data[0].name), []);
              }
            }
          }
          throw app.ask(i18n.__("PROBLEM"));
        });
  }

  function searchMeetup() {
    let city = "";
    let type = "";
    if (requestSource === "google") {
      city = app.getArgument(CITY);
      type = app.getArgument(TYPE) != undefined ? app.getArgument(TYPE) : "";
    } else {
      city = req.body.result.parameters.city;
      type = req.body.result.parameters.type;
    }
    requestPromise(stringUtil(URL_SEARCH_MEETUP)
      .template({ "key": MEETUP_API_KEY, "location": city, "type": type }).s, { resolveWithFullResponse: true })
      .then(
        response => {
          if (response.statusCode === 200) {
            let data = JSON.parse(response.body);

            if (requestSource === "google") {
              if (data.length !== 0) {
                if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
                  if (data.length > 1) {
                    let optionItems = buildOptionItems(app, data);
                    switch (true) {
                      case data.length <= 10:
                        app.askWithCarousel(app.buildRichResponse()
                          .addSimpleResponse({
                            speech: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("CHOOSE"),
                            displayText: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("CHOOSE")
                          }),
                          app.buildCarousel().addItems(optionItems));
                      case data.length <= 30:
                        app.askWithList(app.buildRichResponse()
                          .addSimpleResponse({
                            speech: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("CHOOSE"),
                            displayText: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("CHOOSE")
                          }),
                          app.buildList().addItems(optionItems));
                      default:
                        app.ask(app.buildRichResponse()
                          .addSimpleResponse({
                            speech: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("RETRY_SEARCH"),
                            displayText: i18n.__("NB_MEETUPS_BY_CITY", data.length, city) + i18n.__("RETRY_SEARCH")
                          }));
                    }

                  } else {
                    let linkImage;
                    let textImage;
                    if (data[0].group_photo) {
                      linkImage = data[0].group_photo.highres_link;
                      textImage = "Logo " + data[0].name;
                    } else {
                      linkImage = DEFAULT_IMAGE;
                      textImage = "Default logo";
                    }
                    let parameters = {};
                    parameters["name"] = data[0].urlname;
                    app.setContext(CONTEXT_MEETUP, 5, parameters);
                    app.ask(buildCardGroup(app, data[0], linkImage, textImage));
                  }
                } else {
                  if (data.length > 1) {
                    if (data.length <= 10) {
                      let result = data.map(meetupName => meetupName.name).join(i18n.__("JOIN_RESULT"));

                      app.ask("<speak>" + i18n.__("FOUND", result) + "./speak>");
                    } else {
                      app.ask("<speak>" + i18n.__("NB_MEETUPS", data.length, city) + i18n.__("RETRY_SEARCH") + "</speak>");
                    }
                  } else {
                    let parameters = {};
                    parameters["name"] = data[0].urlname;
                    app.setContext(CONTEXT_MEETUP, 5, parameters);
                    app.ask("<speak>" + i18n.__("FOUND", data[0].name) + "</speak>");
                  }
                }
              } else {
                app.ask("<speak>" + i18n.__("NO_RESULTS") + "</speak>");
              }
            } else {
              if (data.length !== 0) {
                let text;
                if (data.length > 1) {
                  text = i18n.__("NB_MEETUPS_BY_CITY", data.length, city);
                } else {
                  text = i18n.__("FOUND", data[0].name);
                }
                let slackData = [];
                for (let d of data) {
                  let linkImage;
                  if (d.group_photo) {
                    linkImage = d.group_photo.highres_link;
                  } else {
                    linkImage = DEFAULT_IMAGE;
                  }
                  let meetup = {
                    title: d.name,
                    text: htmlToText.fromString(d.description, { wordwrap: 300 }),
                    thumb_url: linkImage,
                    color: RED_COLOR
                  };
                  slackData.push(meetup);
                }
                buildSlackMessage(res, text, slackData);
              } else {
                buildSlackMessage(res, i18n.__("NO_RESULTS"), []);
              }
            }
          }
          throw app.ask(i18n.__("PROBLEM"));
        });
  }

  function meetupSelected() {
    let name = app.getContextArgument("actions_intent_option", "OPTION").value;
    if (!name) {
      app.ask({
        speech: i18n.__("NO_SELECT"),
        displayText: i18n.__("NO_SELECT")
      });
    } else {
      requestPromise(stringUtil(URL_FIND_MEETUP).template({ "name": name }).s, { resolveWithFullResponse: true }).then(
        response => {
          if (response.statusCode === 200) {
            let data = JSON.parse(response.body);
            if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
              let linkImage;
              let textImage;
              if (data.group_photo) {
                linkImage = data.group_photo.highres_link;
                textImage = "Logo " + data.name;
              } else {
                linkImage = DEFAULT_IMAGE;
                textImage = "Default logo";
              }
              let parameters = {};
              parameters["name"] = name;
              app.setContext(CONTEXT_MEETUP, 5, parameters);
              app.ask(buildCardGroup(app, data, linkImage, textImage));
            } else {
              app.ask("<speak>" + i18n.__("FOUND", data.name) + "</speak>");
            }
          }
          throw app.ask(i18n.__("PROBLEM"));
        });
    }
  }

  function confirmationRSVPYes() {
    let name = app.getArgument(NAME);
    let id = app.getArgument(ID);

    let options = {
      method: "POST",
      uri: URL_RSVP_MEETUP,
      form: {
        event_id: id,
        rsvp: "yes",
        key: MEETUP_API_KEY
      },
      json: true
    };

    requestPromise(options)
      .then(function (body) {
        app.ask(i18n.__("INSCRIPTION_OK"));
      })
      .catch(function (err) {
        app.ask(i18n.__("CONFIRMATION_NO") + err);
      });
  }

  function confirmationNo() {
    if (requestSource === "google") {
      assistant.ask({
        speech: i18n.__("CONFIRMATION_NO"),
        displayText: i18n.__("CONFIRMATION_NO")
      });
    } else {
      buildSlackMessage(res, i18n.__("CONFIRMATION_NO"), []);
    }
  }

  let actionMap = new Map();
  actionMap.set(WELCOME_MEETUP_INTENT, welcomeMeetup);
  actionMap.set(BYE_MEETUP_INTENT, byeMeetup);
  actionMap.set(ASK_MEETUP_INTENT, askMeetup);
  actionMap.set(SEARCH_MEETUP_INTENT, searchMeetup);
  actionMap.set(MEETUP_SELECTED_INTENT, meetupSelected);
  actionMap.set(FIND_NEXT_EVENT_INTENT, findNextEvent);
  actionMap.set(CONFIRMATION_RSVP_YES_INTENT, confirmationRSVPYes);
  actionMap.set(CONFIRMATION_EVENT_NO_INTENT, confirmationNo);
  actionMap.set(CONFIRMATION_RSVP_NO_INTENT, confirmationNo);
  app.handleRequest(actionMap);
});

function buildSlackMessage(response, text, slackData) {
  let responseJson = {
    data: {
      slack: {
        text: text,
        attachments: slackData
      }
    },
    speech: text,
    text: text
  };
  response.json(responseJson);
}

function buildCardGroup(app, data, linkImage, textImage) {
  return app.buildRichResponse()
    .addSimpleResponse({
      speech: i18n.__("FOUND", data.name),
      displayText: i18n.__("FOUND", data.name)
    })
    .addBasicCard(app.buildBasicCard(data.name)
      .setTitle(data.name)
      .setBodyText(htmlToText.fromString(data.description, { wordwrap: 300 }))
      .addButton(i18n.__("SEE"), data.link)
      .setImage(linkImage, textImage))
    .addSimpleResponse({
      speech: i18n.__("SHOW_NEXT_EVENT", data.name),
      displayText: i18n.__("SHOW_NEXT_EVENT", data.name)
    })
    .addSuggestions([i18n.__("SURE"), i18n.__("NO")]);
}

function buildCardEvent(app, data) {
  let venue = "";
  if (data.venue) {
    venue = i18n.__("VENUE", data.venue.name, data.venue.address_1, data.venue.city);
  }
  return app.buildRichResponse()
    .addSimpleResponse({
      speech: i18n.__("NEXT_EVENT", data.group.name, data.name),
      displayText: i18n.__("NEXT_EVENT", data.group.name, data.name)
    })
    .addBasicCard(app.buildBasicCard(data.name)
      .setTitle(data.name)
      .setBodyText(i18n.__("NEXT_DATE_EVENT", dateFormat(new Date(data.time), "dd/mm/yyyy HH:MM"), venue))
      .addButton(i18n.__("SHOW_EVENT"), data.link)
      .setImage(DEFAULT_RSVP, "RSVP"))
    .addSimpleResponse({
      speech: i18n.__("INSCRIPTION"),
      displayText: i18n.__("INSCRIPTION")
    })
    .addSuggestions([i18n.__("SURE"), i18n.__("NO")]);
}

function buildOptionItems(app, data) {
  let optionItems = [];
  for (let meetup of data) {
    let optionItem = app.buildOptionItem(meetup.urlname, [meetup.name])
      .setTitle(meetup.name)
      .setDescription(htmlToText.fromString(meetup.description, { wordwrap: 300 }));
    if (meetup.group_photo) {
      optionItem.setImage(meetup.group_photo.highres_link, "Logo " + meetup.name);
    } else {
      optionItem.setImage(DEFAULT_IMAGE, "Default logo");
    }
    optionItems.push(optionItem);
  }
  return optionItems;
}

