/*
 * mongo-edu
 *
 * Copyright (c) 2014-2016 Przemyslaw Pluta
 * Licensed under the MIT license.
 * https://github.com/przemyslawpluta/mongo-edu/blob/master/LICENSE
 */

var request = require('request'),
    cheerio = require('cheerio'),
    ProgressBar = require('progress'),
    _ = require('lodash'),
    videoHandler = require('./videos'),
    PrettyError = require('pretty-error'),
    prompts = require('./prompts'),
    inquirer = require('inquirer'),
    coursewareHandler = require('./courseware');

var jar = request.jar(), host = 'https://university.mongodb.com',
    pe = new PrettyError(), xcsrftoken = {};

function addCookies(cookies, url) {

    'use strict';

    _.each(cookies, function cookies(cookie) { jar.setCookie(cookie, url + '/login'); });
}

module.exports = {

    init: function init(opt, argv, callback) {

        'use strict';

        var url = host,
            bar = new ProgressBar('>'.magenta + ' Searching [:bar] :percent', { complete: '=', incomplete: ' ', width: 20, total: 6 }),
            CSRFTokenCookie = '',

        login = function login(token) {

            xcsrftoken = { 'X-CSRFToken': token[0].split('=')[1] };

            request({
                uri: url + '/login',
                method: 'POST',
                jar: jar,
                headers: xcsrftoken,
                form: { 'email': opt.user, 'password': opt.password }
            }, function post(err, res, body) {

                if (err !== null) { return callback(err, null); }

                if (res.statusCode === 200) {
                    var status = JSON.parse(body);
                    if (status.success !== true) { return console.log('i'.red + ' ' + status.value + '\n'); }

                    bar.tick();

                    return checkProfile(bar);

                }

                callback(pe.render(new Error(res.statusCode)));

            });
        },

        checkProfile = function checkProfile(bar) {
            request({ url: url + '/edit_profile', jar: jar }, function get(err, res, body) {
                if (err !== null) { return callback(err, null); }

                bar.tick();

                if (res.statusCode === 200) {

                    bar.tick();

                    var $ = cheerio.load(body),
                        provider = $('select[name="provider"] option:selected'),
                        language = $('select[name="language"] option:selected'),
                        currentProfile = {
                            preset: {
                                video: [provider.text(), provider.val()],
                                language: [language.text(), language.val()]
                            },
                            firstName: $('input[name="first_name"]').attr('value'),
                            lastName: $('input[name="last_name"]').attr('value'),
                            username: $('input[name="username"]').attr('value')
                        };

                    return checkCourses(bar, currentProfile);
                }

                callback(pe.render(new Error(res.statusCode)));
            });

        },

        courseSection = function courseSection() {
            var list = prompts.list;
            list[0].message = 'Select Courses:';
            list[0].choices = [{name: 'Current', value: 'tab-current'}, {name: 'Completed', value: 'tab-completed'}];
            return list;
        },

        processSelection = function processSelection(body, answers, currentProfile, callback) {

            var list = [], $ = cheerio.load(body),
                current = $('#' + answers.url),
                link = current.find('div.section-course').children().find('h4').children(),
                noCourses = current.find('section.section-courses-empty').text(),
                findNewCourses = current.find('div.section-courses-empty-buttons a').attr('href');

            $(link).each(function each(i, item) {
                list.push({ name: $(item).text(), value: url + $(item).attr('href').replace(/about|info|syllabus/g, '') + ((!argv.h) ? (argv.cw || argv.cwd) ? 'courseware' : 'course_wiki' : 'syllabus') });
            });

            if (noCourses) { currentProfile.noCourses = noCourses.trim().split('\n').map(function items(item) {
                return item.replace(/  +/g, ' ');
            }).join('').replace(/  +/g, ' ') + ' at ' + url + findNewCourses + '.\n'; }

            return callback(null, list, currentProfile);
        },

        checkCourses = function checkCourses(bar, currentProfile) {

            bar.tick();

            request({ url: url + '/dashboard', jar: jar }, function get(err, res, body) {
                if (err !== null) { return callback(err, null); }

                bar.tick();

                if (res.statusCode === 200) {

                    bar.tick();

                    return inquirer.prompt(courseSection(), function prompt(answers) {
                        processSelection(body, answers, currentProfile, callback);
                    });

                }

                callback(pe.render(new Error(res.statusCode)));

            });
        };

        request(url, function (err, res) {

            if (err !== null) { return callback(err, null); }

            if (res.statusCode === 200) {

                addCookies(res.headers['set-cookie'], url);

                CSRFTokenCookie = res.headers['set-cookie'][0].split(';');

                return login(CSRFTokenCookie);

            }

            callback(pe.render(new Error(res.statusCode)));

        });
    },

    getList: function getList(opt, argv, callback) {

        'use strict';

        request({ url: opt.url, jar: jar, headers: { 'Referer' : opt.url.replace('course_wiki', 'syllabus'), }}, function get(err, res, body) {
            if (err !== null) { return callback(err, null); }

            if (res.statusCode === 404) { return callback(null, [], true);  }

            if (res.statusCode === 200) {

                var list = [], getCourses = [], $ = cheerio.load(body), options = (!argv.h)? 'Video|playlist' : 'Handout';

                if (!argv.h) {

                    if (argv.cw || argv.cwd) { return coursewareHandler.findDetails($, callback); }

                    $('div.wiki-article p').children().filter('a').map(function map(i, item) {
                        var current = $(item);
                        if (current.text().match(options)) {
                            list.push({ href: current.attr('href'), text: current.text() });
                        }
                    });

                    getCourses = _.filter(list, function map(item) {
                        if (item.href.match(/(wiki\/M101|wiki\/M102|wiki\/C100|wiki\/M202|wiki\/list-youtube-links|playlist\?list|view_play_list)/)) { return item; }
                    });

                    return callback(null, _.map(getCourses, function map(item) { return { name: item.text, value: item.href }; }));

                } else {

                    $('tbody tr').map(function map(i, item) {
                        var current = $(item),
                            text = current.children().first().text(),
                            href = $(current.children().last().find('a')).attr('href');

                        if (text) { text = text.trim(); }

                        if (href) { list.push({ name: text, value: host + href }); }

                    });

                    if (list.length) { list.unshift({name: 'All', value: 'all', checked: true}, {name: 'Cancel', value: 'cancel'}); }

                    return callback(null, list, true);

                }

            }

            callback(pe.render(new Error(res.statusCode)));

        });

    },

    listVideos: function listVideos(opt, argv, callback) {

        'use strict';

        var videos = [], list, $, current;

        if (argv.cw || argv.cwd) { return coursewareHandler.filterVideos(opt, host, jar, argv, callback); }

        if (opt.url.match(/playlist\?list|view_play_list/)) {
            return videoHandler.listVideosFromPlaylist(opt, argv, callback);
        }

        request({ url: opt.url, jar: jar }, function get(err, res, body) {
            if (err !== null) { return callback(err, null); }
            if (res.statusCode === 200) {
                $ = cheerio.load(body);
                list = $('div.wiki-article');

                current = list.find('code').text();

                if (current.match(/http:\/\/|https:\/\//)) { videos = _.compact(current.split('\n')); }

                if (!videos.length) {

                    list.children('p').children().each(function each(i, item) {
                        var current = $(item), href = current.attr('href');
                        if (href && href.match(/http:\/\/|https:\/\//)) { videos.push(href); }
                    });
                }

                return callback(null, videos);
            }

            callback(pe.render(new Error(res.statusCode)));
        });
    },

    checkProxy: function checkProxy(target, callback) {

        'use strict';

        request(target, function get(err, response) {
            if (err !== null) { return callback(err); }
            if (response.statusCode === 200) {
                var stack = '';
                if (response.headers.server) { stack = 'Proxy Server: '.bold + response.headers.server.cyan + ' '; }
                if (response.headers['x-powered-by']) { stack += 'Powered-by: '.bold + response.headers['x-powered-by'].cyan + ' '; }
                stack.trim();
                if (stack === '') { stack = target; }
                return callback(null, stack);
            }
            callback(new Error('Server Response: '.red + response.statusCode));
        });
    },

    updateProfile: function updateProfile(options, callback) {

        'use strict';

        request({
            uri: host + '/save_video_preferences',
            method: 'POST',
            jar: jar,
            headers: xcsrftoken,
            form: { csrfmiddlewaretoken: xcsrftoken, provider: options.provider, language: options.language }
        }, function post(err, res, body) {

            if (err !== null) { return callback(err, null); }
            if (res.statusCode === 200) { return callback(null, JSON.parse(body)); }
            callback(pe.render(new Error(res.statusCode)));

        });
    }
};
