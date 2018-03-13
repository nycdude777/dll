var DllLogger = DllLogger || new (function () {
    var $LoggerImplementation = function (name) {
        return new function () {
            var _this = this;
            _this.name = name;
            _this.verbose = true;
            _this.enable = function () { _this.verbose = true; };
            _this.disable = function () { _this.verbose = false; };
            _this.log = function (message) { if (_this.verbose) { console.log(_this.name + ': ' + message); } };
            _this.info = function (message) { if (_this.verbose) { console.info(_this.name + ': ' + message); } };
            _this.warn = function (message) { if (_this.verbose) { console.warn(_this.name + ': ' + message); } };
            _this.error = function (message) { if (_this.verbose) { console.error(_this.name + ': ' + message); } };
            return _this;
        };
    };
    return new function () {
        var _this = this;
        _this.create = function (name) {
            if (typeof name == 'undefined' || typeof name == 'null') throw 'Invalid logger name ' + name;
            if (_this.hasOwnProperty(name)) { throw name + ' logger already exists or the name is invalid'; }
            _this[name] = new $LoggerImplementation(name);
            return _this[name];
        };
        return _this;
    };
})();

var dllmodules = [];
var _dllscriptcallbacks = {};
window.dll = (function () {

    var logger = DllLogger.create('dll');
    logger.disable();

    /////////////////////////////// Extensions
    Array.prototype.first = Array.prototype.first || function (qualifier) {
        var retval;
        this.forEach(function (item) {
            if (typeof qualifier === 'undefined' ? true : qualifier) {
                retval = item;
                return true;
            }
        });
        return retval;
    }

    Array.prototype.last = Array.prototype.last || function (qualifier) {
        return this.reverse().first(qualifier);
    }

    //extend Array.protoype if needed
    Array.prototype.all = Array.prototype.all || function (qualifier) {
        var someAreFalse = this.some(function (x) {
            var result = qualifier(x);
            return !result;
        });
        return !someAreFalse;
    }

    /////////////////////////////// Classes 


    var ModuleInfo = function (name, url) {
        var instance = this;
        instance.name = name;
        instance.url = url;
        return instance;
    };

    var Callback = function (callback, qualifier, param) {
        var instance = this;
        instance.callback = callback;
        instance.qualifier = qualifier;
        instance.param = param;
        return instance;
    };

    ////////////////////////////// Requirements
    var __namedRequirements = {};
    var __urlRequirements = {};
    var __batches = {};
    var __modulesByUrl = {};

    ////////////////////////////// Namespace    

    var __namespaces = {};

    var DllNamespace = function (name, base) {

        var instance;

        if (typeof base != 'undefined') { //we have an argument
            instance = base;
        }
        else {
            instance = this;
        }

        instance.logger = logger;

        var shortname = name ? name : 'dll';
        instance._nsname = name ? 'dll.' + name : 'dll';

        if (instance._nsname != 'dll') {
            if (__namespaces.hasOwnProperty(shortname.toLowerCase())) {
                throw 'Namespace ' + shortname.toLowerCase() + ' already exists';
            }
            __namespaces[shortname.toLowerCase()] = instance;
            if (window) {
                if (!window['$' + shortname]) {
                    window['$' + shortname] = instance;
                }
            }
        }

        instance._buildtarget = {}; //this is the object being built
        instance._yielded = false;
        instance._modules = [];

        // using extend, we can replace the blank base, with any object of own
        instance.extend = function (custombase) {
            logger.log('> Start extending custom object ' + instance._nsname);
            instance._buildtarget = custombase;
            return instance;
        };

        /*
            Modules
        */

        var _path;
        instance.path = function (path) {
            _path = path[path.length - 1] == '/' ? path.substring(0, path.length - 1) : path;
            return instance;
        };


        //called back by module after it has self invoked
        instance.inject = function (name, moduleInstance, namespaceifexists) {

            var nsname, targetns;

            // if specified namespace exists, use it as target
            if (namespaceifexists && instance[namespaceifexists.toLowerCase()]) {
                targetns = instance[namespaceifexists.toLowerCase()];
                if (name.toLowerCase() !== namespaceifexists.toLowerCase()) {
                    nsname = targetns._nsname + '.' + name.toLowerCase();
                }
                else {
                    nsname = targetns._nsname;
                }
            } else {
                targetns = instance; //instance._buildtarget;
                nsname = instance._nsname;
            };

            if (targetns.hasOwnProperty(name.toLowerCase())) {
                logger.warn('. INJECTION WARNING! A module with this name already exists: ' + nsname + '.' + name);
            }

            logger.log('. Injecting ' + nsname + '.' + name.toLowerCase() + '');

            logger.log('. ' + nsname + '.' + name.toLowerCase() + ' <----- Injected');
            targetns[name] = moduleInstance;
            //targetns._modules.push(name);

            //this assumes that requirements are static, i.e. only on dll level
            targetns.satisfyNamedRequirement(name);

            return moduleInstance;
        };

        instance.moduleLoaded = function (name, namespaceifexists) {

            var nsname, targetns;

            if (namespaceifexists && instance[namespaceifexists.toLowerCase()]) {
                targetns = instance[namespaceifexists.toLowerCase()];
                if (name.toLowerCase() !== namespaceifexists.toLowerCase()) {
                    nsname = targetns._nsname + '.' + name.toLowerCase();
                }
                else {
                    nsname = targetns._nsname;
                }
            } else {
                targetns = instance;
                nsname = instance._nsname;
            };

            if (targetns.hasOwnProperty(name.toLowerCase())) {
                logger.warn('A module with this name already exists: ' + name);
            }

            logger.log('. Loaded module: ' + nsname + '.' + name.toLowerCase() + ' <-----');

            //if requirements are static, we don't need namespace (?)
            targetns.satisfyNamedRequirement(name);

        };

        var getOrCreateNamespace = function (name) {
            if (!instance.hasOwnProperty(name.toLowerCase())) {
                instance[name.toLowerCase()] = new DllNamespace(name.toLowerCase());
            }
            return instance[name.toLowerCase()];
        };

        instance.namespace = getOrCreateNamespace;
        instance.ns = getOrCreateNamespace; //just a short hand alias

        instance._enquedScripts = [];
        instance.addScriptNow = function (scriptItem) {

            logger.log('> Add script ' + scriptItem.src);

            instance.require(scriptItem.name);

            var moduleUrl = scriptItem.src;
            __modulesByUrl[moduleUrl.toLowerCase()] = scriptItem.name;

            //we already created a named requirement above using require()
            //no need to create a URL requirement, as the script will satisfy 
            //the named requirement when it loads and calls moduleLoaded()
            instance.addScript(moduleUrl, false);
            scriptItem.added = true;

        };

        instance.enqueScript = function (name, url) {
            var newitem = { name: name, src: url, added: false, loaded: false };
            instance._enquedScripts.push(newitem);
            return newitem;
        };

        instance.scriptsPending = function () {
            return instance._enquedScripts.some(function (script) {
                return !script.loaded;
            });
        };

        instance.load = function (name, url) {
            
            var moduleName, fileName;

            //parse the url            
            var ext = '.js';
            var fileNameAndExt = url.split('/').last();

            if (name) {
                moduleName = name;
            }
            else {
                moduleName = fileNameAndExt.substring(0, fileNameAndExt.length - ext.length);
            }

            fileName = moduleName + ext;

            var scriptsPending = instance.scriptsPending();

            var scriptItem = instance.enqueScript(name, url);

            if (!scriptsPending) {
                instance.addScriptNow(scriptItem);
            }

            return instance;
        };



        /* 
            Requirements 
        */
        instance.satisfyNamedRequirement = function (name) {
            if (__namedRequirements.hasOwnProperty(name.toLowerCase())) {
                __namedRequirements[name.toLowerCase()].satisfied = true;
            }
            else {
                logger.info(name + ' is satisfied but was not explicitly required');
            }

            tryProcessRequirementCallbacks();
        };

        instance.satisfyUrlRequirement = function (url) {
            if (__urlRequirements.hasOwnProperty(url.toLowerCase())) {
                __urlRequirements[url.toLowerCase()].satisfied = true;
            }
            if (__modulesByUrl.hasOwnProperty(url.toLowerCase())) {
                instance.satisfyNamedRequirement(__modulesByUrl[url.toLowerCase()]);
            }

            tryProcessRequirementCallbacks();
        };

        var _createRequirement = function (map, id, batchid, resolve, reject) {
            if (!map.hasOwnProperty(id.toLowerCase())) {
                map[id.toLowerCase()] = {
                    id: id,
                    satisfied: false,
                    callbacks: [],
                    batchid: batchid
                };
            }
            if (batchid) {
                if (!__batches.hasOwnProperty(batchid)) {
                    __batches[batchid] = {
                        ids: [],
                        resolve: resolve,
                        reject: reject
                    };
                }
                __batches[batchid].ids.push(id);
            }
            else {
                map[id.toLowerCase()].callbacks.push({ resolve: resolve, reject: reject });
            }
        };

        instance.require = function (name, resolve, reject) {
            _createRequirement(__namedRequirements, name, null, resolve, reject);
        };

        var tryProcessRequirementCallbacks = function () {

            //named requirement callbacks
            Object.keys(__namedRequirements).map(function (key) {
                return __namedRequirements[key];
            }).forEach(function (r) {
                if (r.satisfied) {
                    r.callbacks.forEach(function (cb) {
                        if (cb && cb.resolve && !cb.processed) {
                            cb.processed = true;
                            cb.resolve();
                        }
                    });
                }
            });

            //url callbacks
            Object.keys(__urlRequirements).map(function (key) {
                return __urlRequirements[key];
            }).forEach(function (r) {
                if (r.satisfied) {
                    r.callbacks.forEach(function (cb) {
                        if (cb && cb.resolve && !cb.processed) {
                            cb.processed = true;
                            cb.resolve(r.id);
                        }
                    });
                }
            });

            //process batch callbacks
            Object.keys(__batches).map(function (key) {
                return __batches[key];
            }).forEach(function (batch) {
                if (batch.urls.all(function (url) {
                    if (!__urlRequirements.hasOwnProperty(url.toLowerCase())) {
                        throw 'Batch contains invalid url: ' + url;
                    }
                    return __urlRequirements[url.toLowerCase()].satisfied;
                })) {
                    if (batch.resolve && !batch.processed) {
                        batch.processed = true;
                        batch.resolve();
                    }
                }
            });

            instance.tryYieldDll();
        };

        //adds a dynamic script tag to the document with an onload callback                
        instance.scriptLoaded = function (tag) {
            var src = tag.getAttribute('src');
            logger.log('. ' + src + ' <----- Script loaded');

            //mark enqued script as loaded
            //check if there are more scripts enqued
            //add next script
            var loadedScript = instance._enquedScripts.first(function (item) {
                return item.src == src;
            });
            loadedScript.loaded = true;

            var nextScript = instance._enquedScripts.first(function (item) {
                return !item.added;
            });

            if (nextScript) {

                logger.log('. adding next script tag: ' + src);
                instance.addScriptNow(nextScript);
                return;
            }


            instance.satisfyUrlRequirement(tag.getAttribute('src'));
        };

        instance.addScript = function (url, require, onload) {
            logger.log('---> Script tag added: ' + url);
            var typeofdoc = typeof document;
            if (typeofdoc !== 'undefined') {
                var script = document.createElement('script');
                script.setAttribute('src', url);
                script.setAttribute('onload', 'dll.scriptLoaded(this)');
                if (require) {
                    _createRequirement(__urlRequirements, url, null, onload);
                }
                document.body.appendChild(script);
            }
            else {
                logger.warn('document object is undefined.  Script tag not added: ' + url);
            }
        };

        /* 
            dll.build()
        */

        instance._yieldcallbacks = [];

        var _ready = function (callback) {
            if (!isReady()) {
                instance._yieldcallbacks.push({ callback: callback, processed: false });
                return instance;
            }
            callback(instance);
        };

        /*ready() and yield() are the same*/
        instance.ready = _ready;
        /*ready() and yield() are the same*/
        instance.yield = _ready;

        instance.tryYieldDll = function (propagating) {

            var isready = isReady();

            if (isready) {
                instance._yieldcallbacks.forEach(function (cb) {
                    if (!cb.processed) {
                        cb.processed = true;
                        logger.log('. ' + instance._nsname + ' <----- Yield');
                        cb.callback(instance);
                    }
                });

                //try yielding other namespaces
                if (!propagating) {
                    Object.keys(__namespaces).forEach(function (key) {
                        var ns = __namespaces[key];
                        ns.tryYieldDll(true);
                    });
                }
            }

        };

        function isReady() {
            var namedReqs = Object.keys(__namedRequirements).map(function (key) { return __namedRequirements[key]; });
            var urlReqs = Object.keys(__urlRequirements).map(function (key) { return __urlRequirements[key]; });
            var batchReqs = Object.keys(__batches).map(function (key) { return __batches[key]; });
            var allNamedReqsSatisfied = namedReqs.length == 0 || namedReqs.all(function (x) { return x.satisfied; });
            var allUrlReqsSatisfied = urlReqs.length == 0 || urlReqs.all(function (x) { return x.satisfied; });
            var allBatchReqsSatisfied = batchReqs.all(function (batch) {
                return batch.urls.all(function (url) {
                    return __urlRequirements[url.toLowerCase()].satisfied;
                });
            });
            var isready = allNamedReqsSatisfied && allUrlReqsSatisfied && allBatchReqsSatisfied;
            return isready;
        }
        return instance;
    }

    var _dll = new DllNamespace();

    jQuery(function () {
        //singleton.addScript('/content/solution/eqd/shared/js/eqd-extensions.js', true);
        //singleton.addScript('/content/solution/eqd/shared/js/eqd-helpers.js', true);
        //singleton.addScript('/content/solution/eqd/shared/js/eqd-stack.js', true);
        //singleton.addScript('/content/solution/eqd/shared/js/eqd-api.js', true);
    });

    _dll.Namespace = DllNamespace;

    _dll.echo = function () {
        return 'dll is ready';
    };

    return _dll;

})();


// JavaScript source code
