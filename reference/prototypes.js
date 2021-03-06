// CONSTANTS FOR NAME GENERATION

const ID_LENGTH = 3;
const ALPHABET = ['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
const ALPHABET_LENGTH = 62;
const ROOM_BLACKLIST = {'W95N23':true,'W96N21':true}

/*
* Auxiliary Functions
*/
getName = function(job){
    let _name = job? job[0]:"";
    for(i=0;i<ID_LENGTH;i++){
        _name += ALPHABET[parseInt(Math.random()*ALPHABET_LENGTH)];
    }
    return _name;
}

/*
* Looks for the greatest open space square around origin point in a given radius
*/
getFreeSquareCenter = function(origin,rangeToOrigin,squareRadius){
    return false;
}

// CACHE REFRESH CONSTANTS


const RESOURCES_REFRESH_TIME = 10;

const CONTRUCTION_SITE_REFRESH_TIME = 10;
const STRUCTURE_REFRESH_TIME = 50;

const MINERALS_REFRESH_TIME = 10000;
const SOURCES_REFRESH_TIME = MINERALS_REFRESH_TIME;

const PUNY_PUN_ARRAY = ["Be PINK or be purged!",
                        "There is only one color,and it is PINK!",
                        "How can a creep be happy if it cannot serve PINK with all his ticks?",
                        "PINK! PINK! PINK! A color as pure as it is deep! PINK! PINK! PINK! Let it flow, let it run free!",
                        "PINK will be done",
                        "To the Red\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "To the Blue\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "To the Green\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "To the Black\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "To the White\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "To the Yellow\n-That is the mark of the Mutant. \nTo be PINK\n-For that is the fate of all Mutants",
                        "PINK will befall you!",
                        "There is no hope, only PINK",
                        "Devote every tick to PINK",
                        "#ff00b4 is the answer"
                        ];


module.exports = function(){

	/*
	* GAME (cannot be edited)
	*/
	
	/*
	* ROOM
	*/
	
		Object.defineProperties(Room.prototype,{
			
			/**
		     * Returns the rooms coordinates regarding map position and their ids
			 * @return {String,Number,String,Number} xId,x,yId,y
		     */
		    'coords' : {
		        get: function(){
		            var arr = this.name.match(/[A-Z]|[0-9]+/g);
		            var out;
		            if(arr.length == 4){
		                out = {};
		                out.xId= arr[0];
		                out.x = parseInt(arr[1]);
		                out.yId= arr[2];
		                out.y = parseInt(arr[3]);
		            }
                    return out;
		        },
				configurable: true,
				enumerable: false
		    },
			
			/** 
			* Returns timestamp the object was last searched for
			* @param {string}
			* @return {Number}
			*/
			'setLastSeen' : {
				value: function(objectName) {
					if (this.memory.lastSeen){
						this.memory.lastSeen[objectName] = Game.time;
					}else{
						this.memory.lastSeen={};
						this.memory.lastSeen[objectName] = Game.time;
					}
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns timestam the object was last searched for
			* @param {string}
			* @return {Number}
			*/
			'lastSeen' : {
				value: function(objectName) {
					if (this.memory.lastSeen){
						return this.memory.lastSeen[objectName];
					}else{
						this.memory.lastSeen={};
						return 0;
					}
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Finds all constructionSites, minerals, resources, sources and structures in room to add their ids to room memory
			* Returns numbers of found objects in array
			* @return {[Number]}
			*/
			'findAll' : {
				value: function() {
					let cS = this.findConstructionSites();
					let m = this.findMinerals();
					let r = this.findResources();
					let s = this.findSources();
					let str = this.findStructures();
					return [cS.length,m.length,r.length,s.length,str.length];
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the constructionSites found in room and saves their id in room memory
			* @return {[ConstructionSite]} objectArray
			*/
			'findConstructionSites' : {
				value: function() {
					this._constructionSites = this.find(FIND_CONSTRUCTION_SITES);
					for (let i in this._constructionSites){
						this._constructionSites[i].memory;
					}
					this.setLastSeen("constructionSites");
					return this._constructionSites;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the constructionSites whose ids are saved in room memory
			* @return {[constructionSite]} objectArray
			*/
			'constructionSites' : {
				get: function() {
					if(!this._constructionSites){
						if (this.lastSeen("constructionSites") >= Game.time-CONTRUCTION_SITE_REFRESH_TIME){
							let objectArray = [];
							if (this.memory && this.memory.constructionSites){
								let keys = Object.keys(this.memory.constructionSites);
								for (let i in keys){
									if (Object.keys(this.memory.constructionSites[keys[i]]).length > 0){
										for (let id in this.memory.constructionSites[keys[i]]){
											let obj = Game.getObjectById(id);
											if (obj && ConstructionSite.prototype.isPrototypeOf(obj)){
												objectArray.push(obj);
											}else{
												delete this.memory.constructionSites[keys[i]][id];
											}
										}
									}else{
										delete this.memory.constructionSites[keys[i]];
									}
								}
								if (keys.length == 0){
									delete this.memory.constructionSites;
								}
							}
							this._constructionSites = objectArray;
						}else{
							this.findConstructionSites();
						}
					}
					return this._constructionSites;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Clears room constructionSites
			*/
			'clearConstructionSites' : {
				value: function() {
					if (!this.lastSeen("constructionSites") || this.lastSeen("constructionSites") <= Game.time){
						this.findConstructionSites();
					}
					let objectArray = [];
					if (this.memory && this.memory.constructionSites){
						let keys = Object.keys(this.memory.constructionSites);
						for (let i in keys){
							if (Object.keys(this.memory.constructionSites[keys[i]]).length > 0){
								for (let id in this.memory.constructionSites[keys[i]]){
									let obj = Game.getObjectById(id);
									if (obj && ConstructionSite.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
										obj.remove();
										delete this.memory.constructionSites[keys[i]][id];
									}else{
										delete this.memory.constructionSites[keys[i]][id];
									}
								}
							}else{
								delete this.memory.constructionSites[keys[i]];
							}
						}
						if (keys.length == 0){
							delete this.memory.constructionSites;
						}
					}
					return objectArray.length;
				},
				configurable: true,
				enumerable: false
			},
			
			/** NEEDS UPDATE - BUT STILL WORKS
			* Returns array of the constructionSites of given structureType whose ids are saved in room memory
			* @param {String} structureType
			* @return {[constructionSite]} objectArray
			*/
			'constructionSitesByType' : {
				value: function(structureType) {
					if (this.lastSeen("constructionSites") == Game.time){
						let objectArray = [];
						if (this.memory && this.memory.constructionSites && this.memory.constructionSites[structureType]){
							for (let id in this.memory.constructionSites[structureType]){
								let obj = Game.getObjectById(id);
								if (obj && ConstructionSite.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.constructionSites[structureType][id];
								}
							}
						}
					return objectArray;
					}else{
						return this.findConstructionSites().filter((s) => s.structureType == structureType);
					}
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'creeps' : {
				get: function() {
					return this.myCreeps.concat(this.hostileCreeps).concat(this.alliedCreeps);
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'hostileCreeps' : {
				get: function() {
					if (!this._hostileCreeps) {
						let hostileCreeps = this.find(FIND_HOSTILE_CREEPS);
						let alliedCreeps = [];
						if (Memory.globals && Memory.globals.ally){
							for(let i = hostileCreeps.length-1; i >= 0; i--) {
								if(Memory.globals.ally[hostileCreeps[i].owner.username]) alliedCreeps.push(hostileCreeps.splice(i,1));
							}
						}
						this._hostileCreeps = hostileCreeps;
						this._alliedCreeps = alliedCreeps;
					}
					return this._hostileCreeps;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'alliedCreeps' : {
				get: function() {
					if (!this._alliedCreeps) {
						let hostileCreeps = this.find(FIND_HOSTILE_CREEPS);
						let alliedCreeps = [];
						if (Memory.globals && Memory.globals.ally){
							for(let i = hostileCreeps.length-1; i >= 0; i--) {
								if(Memory.globals.ally[hostileCreeps[i].owner.username]) alliedCreeps.push(hostileCreeps.splice(i,1));
							}
						}
						this._hostileCreeps = hostileCreeps;
						this._alliedCreeps = alliedCreeps;
					}
					return this._alliedCreeps;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'myCreeps' : {
				get: function() {
					if (!this._myCreeps) {
						this._myCreeps = this.find(FIND_MY_CREEPS);
					}
					return this._myCreeps;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the minerals found in room and saves their id in room memory
			* @return {[Mineral]} objectArray
			*/
			'findMinerals' : {
				value: function() {
					this._minerals = this.find(FIND_MINERALS);
					for (let i in this._minerals){
						this._minerals[i].memory;
					}
					this.setLastSeen("minerals");
					return this._minerals;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the minerals whose ids are saved in room memory
			* @return {[Mineral]} objectArray
			*/
			'minerals' : {
				get: function() {
					if (!this._minerals){
						if (this.lastSeen("minerals") >= Game.time-MINERALS_REFRESH_TIME){
							let objectArray = [];
							if (this.memory && this.memory.minerals){
								for (let id in this.memory.minerals){
									let obj = Game.getObjectById(id);
									if (obj && Mineral.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.minerals[id];
									}
								}
							}
							this._minerals = objectArray;
						}else{
							this.findMinerals();
						}
					}
					return this._minerals;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the constructionSites found in room and saves their id in room memory
			* @return {[Resource]} objectArray
			*/
			'findResources' : {
				value: function() {
					this._resources = this.find(FIND_DROPPED_RESOURCES);
					for (let i in this._resources){
						this._resources[i].memory;
					}
					this.setLastSeen("resources");
					return this._resources;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the resources whose ids are saved in room memory
			* @return {[Resource]} objectArray
			*/
			'resources' : {
				get: function() {
					if(!this._resources){
						if (this.lastSeen("resources") >= Game.time-RESOURCES_REFRESH_TIME){
							let objectArray = [];
							if (this.memory && this.memory.resources){
								for (let id in this.memory.resources){
									let obj = Game.getObjectById(id);
									if (obj && Resource.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.resources[id];
									}
								}
							}
							this._resources = objectArray;
						}else{
							this.findResources();
						}
					}
					return this._resources;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the sources found in room and saves their id in room memory
			* @return {[Source]} objectArray
			*/
			'findSources' : {
				value: function() {
					if(!this._sources){
						let objectArray = this.find(FIND_SOURCES);
						for (let i in objectArray){
							objectArray[i].memory;
						}
						this.setLastSeen("sources");
						this._sources = objectArray;
					}
					return this._sources;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the sources whose ids are saved in room memory
			* @return {[Source]} objectArray
			*/
			'sources' : {
				get: function() {
					if(!this._sources){
						if (this.lastSeen("sources") >= Game.time-SOURCES_REFRESH_TIME){
							let objectArray = [];
							if (this.memory && this.memory.sources){
								for (let id in this.memory.sources){
									let obj = Game.getObjectById(id);
									if (obj && Source.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.sources[id];
									}
								}
							}
							this._sources = objectArray;
						}else{
							this.findSources();
						}
					}
					return this._sources;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the structures found in room and saves (some of) their ids in room memory
			* (roads, walls, ramparts and extensions excluded) 
			* @return {[structure]} objectArray
			*/
			'findStructures' : {
				value: function() {
					if(!this._structures){
						this._structures = this.find(FIND_STRUCTURES);
						for (let i in this._structures){
							let sType = this._structures[i].structureType;
							if (sType != STRUCTURE_ROAD && sType != STRUCTURE_WALL && sType != STRUCTURE_RAMPART && sType != STRUCTURE_EXTENSION && sType != STRUCTURE_SPAWN){
								this._structures[i].memory;
							}
							else if (sType == STRUCTURE_SPAWN){
								this._structures[i].roomMemory;
							}
							if (sType == "observer" || sType == "powerSpawn" || sType == "powerBank" || sType == "extractor" || sType == "nuker" || sType == "terminal" || sType == "storage" || sType == "controller"){ // singular structure ?
								if (sType != "terminal" && sType != "storage" && sType != "controller"){ // already have these
									_.set(this, '_' + sType, this._structures[i]);
								}
							}else{
								_.set(this, '_' + sType + 's', _.get(this,'_'+sType+'s') === undefined? [this._structures[i]] : _.get(this,'_'+sType+'s').concat([this._structures[i]]));
							}
						}
						let initArray = ["spawns","extensions","roads","constructedWalls","ramparts","keeperLairs","portals","links","towers","labs","containers"];
						for(let key in initArray){ // Initialize array if not yet initialized 
							if (_.get(this,'_' + initArray[key]) === undefined){
								_.set(this,'_' + initArray[key], []);
							}
						}
						this.setLastSeen("structures");
					}
					return this._structures;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the structures whose ids are saved in room memory
			* @return {[Source]} objectArray
			*/
			'structures' : {
				get: function() {
					if(!this._structures){
						if (this.lastSeen("structures") >= Game.time-STRUCTURE_REFRESH_TIME){
							let objectArray = [];
							if (this.memory && this.memory.structures){
								for (let key in this.memory.structures){
									for (let id in this.memory.structures[key]){
										let obj = Game.getObjectById(id);
										if (obj && Structure.prototype.isPrototypeOf(obj)){
											objectArray.push(obj);
										}else{
											delete this.memory.structures[key][id];
										}
									}
								}
							}
							this._structures = objectArray.concat(this.roads).concat(this.constructedWalls).concat(this.extensions).concat(this.ramparts); // concat to add those structures which ids are not longer saved in room.memory
						}else{
							this.findStructures();
						}
					}
					return this._structures;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the extensions whose ids are NOT saved in room memory
			* @return {[StructureExtensions]} objectArray
			*/
			'extensions' : {
				get: function() {
					/*
					if (this.lastSeen("structures") == Game.time){
						let objectArray = [];
						if (this.memory && this.memory.structures && this.memory.structures.extension){
							for (let id in this.memory.structures.extension){
								let obj = Game.getObjectById(id);
								if (obj && StructureExtension.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.structures.extension[id];
								}
							}
						}
						return objectArray;
					}else{}*/
					if(!this._extensions){
						this.findStructures();
					}
					return this._extensions;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the extractor whose ids are saved in room memory
			* @return {StructureExtractor} obj
			*/
			'extractor' : {
				get: function() {
					if(!this._extractor){
						if (this.lastSeen("structures") == Game.time){
							let obj;
							if (this.memory && this.memory.structures && this.memory.structures.extractor){
								for (let id in this.memory.structures.extractor){
									let tmpObj = Game.getObjectById(id);
									if (tmpObj && StructureExtractor.prototype.isPrototypeOf(tmpObj)){
										obj = tmpObj;
									}else{
										delete this.memory.structures.extractor[id];
									}
								}
							}
							this._extractor = obj;
						}else{
							this.findStructures();
						}
					}
					return this._extractor;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the keeperLairs whose ids are saved in room memory
			* @return {StructureKeeperLair} obj
			*/
			'keeperLairs' : {
				get: function() {
					if(!this._keeperLairs){
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.keeperLair){
								for (let id in this.memory.structures.keeperLair){
									let obj = Game.getObjectById(id);
									if (obj && StructureKeeperLair.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.keeperLair[id];
									}
								}
							}
							this._keeperLairs = objectArray;
						}else{
							this.findStructures();
						}
					}
					return this._keeperLairs;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the labs whose ids are saved in room memory
			* @return {StructureLab} obj
			*/
			'labs' : {
				get: function() {
					if(!this._labs){
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.lab){
								for (let id in this.memory.structures.lab){
									let obj = Game.getObjectById(id);
									if (obj && StructureLab.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.lab[id];
									}
								}
							}
							this._labs = objectArray;
						}else{
							this.findStructures();
						}
					}
					return this._labs;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the links whose ids are saved in room memory
			* @return {StructureLink} obj
			*/
			'links' : {
				get: function() {
					if(!this._links){
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.link){
								for (let id in this.memory.structures.link){
									let obj = Game.getObjectById(id);
									if (obj && StructureLink.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.link[id];
									}
								}
							}
							this._links = objectArray;
						}else{
							this.findStructures();
						}
					}
					return this._links;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the nuker whose ids are saved in room memory
			* @return {StructureNuker} obj
			*/
			'nuker' : {
				get: function() {
					if(!this._nuker){
						if (this.lastSeen("structures") == Game.time){
							let obj;
							if (this.memory && this.memory.structures && this.memory.structures.nuker){
								for (let id in this.memory.structures.nuker){
									let tmpObj = Game.getObjectById(id);
									if (tmpObj && StructureNuker.prototype.isPrototypeOf(tmpObj)){
										obj = tmpObj;
									}else{
										delete this.memory.structures.nuker[id];
									}
								}
							}
							this._nuker = obj;
						}else{
							this.findStructures();
						}
					}
					return this._nuker;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the observer whose ids are saved in room memory
			* @return {StructureObserver} obj
			*/
			'observer' : {
				get: function() {
					if(!this._observer){
						if (this.lastSeen("structures") == Game.time){
							let obj;
							if (this.memory && this.memory.structures && this.memory.structures.observer){
								for (let id in this.memory.structures.observer){
									let tmpObj = Game.getObjectById(id);
									if (tmpObj && StructureObserver.prototype.isPrototypeOf(tmpObj)){
										obj = tmpObj;
									}else{
										delete this.memory.structures.observer[id];
									}
								}
							}
							this._observer = obj;
						}else{
							this.findStructures();
						}
					}
					return this._observer;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the powerBank whose ids are saved in room memory
			* @return {StructurePowerBank} obj
			*/
			'powerBank' : {
				get: function() {
					if(!this._powerBank){
						if (this.lastSeen("structures") == Game.time){
							let obj;
							if (this.memory && this.memory.structures && this.memory.structures.powerBank){
								for (let id in this.memory.structures.powerBank){
									let tmpObj = Game.getObjectById(id);
									if (tmpObj && StructurePowerBank.prototype.isPrototypeOf(tmpObj)){
										obj = tmpObj;
									}else{
										delete this.memory.structures.powerBank[id];
									}
								}
							}
							this._powerBank = obj;
						}else{
							this.findStructures();
						}
					}
					return this._powerBank;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the powerSpawn whose ids are saved in room memory
			* @return {StructurePowerSpawn} obj
			*/
			'powerSpawn' : {
				get: function() {
					if(!this._powerSpawn){
						if (this.lastSeen("structures") == Game.time){
							let obj;
							if (this.memory && this.memory.structures && this.memory.structures.powerSpawn){
								for (let id in this.memory.structures.powerSpawn){
									let tmpObj = Game.getObjectById(id);
									if (tmpObj && StructurePowerSpawn.prototype.isPrototypeOf(tmpObj)){
										obj = tmpObj;
									}else{
										delete this.memory.structures.powerSpawn[id];
									}
								}
							}
							this._powerSpawn = obj;
						}else{
							this.findStructures();
						}
					}
					return this._powerSpawn;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the ramparts whose ids are NOT saved in room memory
			* @return {[StructureRampart]} objectArray
			*/
			'ramparts' : {
				get: function() {
					/* code to save them in room memory
					if (this.lastSeen("structures") == Game.time){
						let objectArray = [];
						if (this.memory && this.memory.structures && this.memory.structures.rampart){
							for (let id in this.memory.structures.rampart){
								let obj = Game.getObjectById(id);
								if (obj && StructureRampart.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.structures.rampart[id];
								}
							}
						}
						return objectArray;
					}else{}*/
					if(!this._ramparts){
						this.findStructures();
					}
					return this._ramparts;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the spawns whose ids are saved in room memory
			* @return {[StructureSpawn]} objectArray
			*/
			'spawns' : {
				get: function() {
					if (!this._spawns) {
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.spawn){
								for (let id in this.memory.structures.spawn){
									let obj = Game.getObjectById(id);
									if (obj && StructureSpawn.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.spawn[id];
									}
								}
							}
							this._spawns = objectArray;
						}else{
							this.findStructures()
						}
					}
					return this._spawns;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the towers whose ids are saved in room memory
			* @return {[StructureTower]} objectArray
			*/
			'towers' : {
				get: function() {
					if (!this._towers) {
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.tower){
								for (let id in this.memory.structures.tower){
									let obj = Game.getObjectById(id);
									if (obj && StructureTower.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.tower[id];
									}
								}
							}
							this._towers = objectArray;
						}else{
							this.findStructures()
						}
					}
					return this._towers;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the containers whose ids are saved in room memory
			* @return {[StructureContainer]} objectArray
			*/
			'containers' : {
				get: function() {
					if (!this._containers) {
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.container){
								for (let id in this.memory.structures.container){
									let obj = Game.getObjectById(id);
									if (obj && StructureContainer.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.container[id];
									}
								}
							}
							this._containers = objectArray;
						}else{
							this.findStructures();
						}
					}
					return this._containers;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the portals whose ids are saved in room memory
			* @return {[StructurePortal]} objectArray
			*/
			'portals' : {
				get: function() {
					if (!this._portals) {
						if (this.lastSeen("structures") == Game.time){
							let objectArray = [];
							if (this.memory && this.memory.structures && this.memory.structures.portal){
								for (let id in this.memory.structures.portal){
									let obj = Game.getObjectById(id);
									if (obj && StructurePortal.prototype.isPrototypeOf(obj)){
										objectArray.push(obj);
									}else{
										delete this.memory.structures.portal[id];
									}
								}
							}
							this._portals = objectArray;
						}else{
							this.findStructures()
						}
					}
					return this._portals;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the roads whose ids are NOT saved in room memory
			* @return {[StructureRoad]} objectArray
			*/
			'roads' : {
				get: function() {
					/* code to save them in room memory
					if (this.lastSeen("structures") == Game.time){
						let objectArray = [];
						if (this.memory && this.memory.structures && this.memory.structures.road){
							for (let id in this.memory.structures.road){
								let obj = Game.getObjectById(id);
								if (obj && StructureRoad.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.structures.road[id];
								}
							}
						}
						return objectArray;
					}else{}
					*/
					
					if(!this._roads){
						this.findStructures()
					}
					return this._roads;
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the constructed walls whose ids are NOT saved in room memory
			* @return {[StructureWall]} objectArray
			*/
			'constructedWalls' : {
				get: function() {
					/* code to save them in room memory
					if (this.lastSeen("structures") == Game.time){
						let objectArray = [];
						if (this.memory && this.memory.structures && this.memory.structures.constructedWall){
							for (let id in this.memory.structures.constructedWall){
								let obj = Game.getObjectById(id);
								if (obj && StructureWall.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.structures.constructedWall[id];
								}
							}
						}
						return objectArray;
					}else{}*/
					if(!this._constructedWalls){
						this.findStructures()
					}
					return this._constructedWalls;
				},
				configurable: true,
				enumerable: false
			},
			
		});

	/*
	* ROOM_POSITION
	*/

	/*
	* ROOM_OBJECT
	*/

	/*
	* CONTRUCTION_SITE
	*/
		Object.defineProperties(ConstructionSite.prototype,{
			'memory' : {
				get: function() {
					if (this.room.memory.constructionSites === undefined) {
						this.room.memory.constructionSites = {};
					}
					if (this.room.memory.constructionSites[this.structureType] === undefined) {
						this.room.memory.constructionSites[this.structureType] = {};
					}
					if (this.room.memory.constructionSites[this.structureType][this.id] === undefined) {
						this.room.memory.constructionSites[this.structureType][this.id] = {};
					}
					return this.room.memory.constructionSites[this.structureType][this.id];
				},
				set: function(v) {
					return _.set(Memory, this.room.memory.constructionSites[this.structureType][this.id], v);
				},
				configurable: true,
				enumerable: false
			}
		});

	/*
	* CREEP
	*/
		Object.defineProperties(Creep.prototype,{
			
			/** NEEDS TESTING
			* Memory which is located in room memory
			*/
			'roomMemory' : {
				get: function() {
					if (this.my){
						if (this.room.memory.myCreeps === undefined) {
							this.room.memory.myCreeps = {};
						}
						if (this.room.memory.myCreeps[this.id] === undefined) {
							this.room.memory.myCreeps[this.id] = {};
						}
						return this.room.memory.myCreeps[this.id];
					}else if(Memory.globals && Memory.globals.ally && Memory.globals.ally[this.owner.username]){
						if (this.room.memory.alliedCreeps === undefined) {
							this.room.memory.alliedCreeps = {};
						}
						if (this.room.memory.alliedCreeps[this.id] === undefined) {
							this.room.memory.alliedCreeps[this.id] = {};
						}
						return this.room.memory.alliedCreeps[this.id];
					}else{
						if (this.room.memory.hostileCreeps === undefined) {
							this.room.memory.hostileCreeps = {};
						}
						if (this.room.memory.hostileCreeps[this.id] === undefined) {
							this.room.memory.hostileCreeps[this.id] = {};
						}
						return this.room.memory.hostileCreeps[this.id];
					}
				},
				set: function(v) {
					if (this.my){
						if (this.room.memory.myCreeps === undefined) {
							this.room.memory.myCreeps = {};
						}
						if (this.room.memory.myCreeps[this.id] === undefined) {
							this.room.memory.myCreeps[this.id] = {};
						}
						return _.set(Memory, this.room.memory.myCreeps[this.id], v);
					}else if(Memory.globals && Memory.globals.ally && Memory.globals.ally[this.owner.username]){
						if (this.room.memory.alliedCreeps === undefined) {
							this.room.memory.alliedCreeps = {};
						}
						if (this.room.memory.alliedCreeps[this.id] === undefined) {
							this.room.memory.alliedCreeps[this.id] = {};
						}
						return _.set(Memory, this.room.memory.alliedCreeps[this.id], v);
					}else{
						if (this.room.memory.hostileCreeps === undefined) {
							this.room.memory.hostileCreeps = {};
						}
						if (this.room.memory.hostileCreeps[this.id] === undefined) {
							this.room.memory.hostileCreeps[this.id] = {};
						}
						return _.set(Memory, this.room.memory.hostileCreeps[this.id], v);
					}
				},
				configurable: true,
				enumerable: false
			},
			
			"mine" : {
			    value: function(target){
			        if(creep.inRangeTo(target)) {
        			    if (target.energy){
        				    return creep.harvest(target);
        			    }
        			}else{
        				return creep.travelTo(position);
        			}
			    },
				writable: true,
				enumerable: true
			},
			
			"extract" : {
			    value: function(target){
			        if(creep.inRangeTo(target)) {
        			    if (Game.time%6){
        				    return creep.harvest(target);
        			    }
        			}else{
        				return creep.travelTo(position);
        			}
			    },
				writable: true,
				enumerable: true
			},
			
			/**
			* Returns pos.inRangeTo(target,range) iff creep and target share a room, else returns false
			* @param {Object} target
			* @param {Number} range
			* @return {Boolean} 
			*/
			"inRangeTo" : {
				value: function(target,range = 1){// default range is 1
					let roomName = target.roomName || target.pos.roomName;
					if(this.pos.roomName == roomName){ // same room ?
						return this.pos.inRangeTo(target,range);
					}else{
						return false;
					}
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Alternative to native creep.moveTo() which uses the same path as long as possible
			* Returns creep.moveTo() but cannot move to x,y coordinates - use roomPos instead
			* @return {Boolean} 
			*/
			"travelTo" : {
				value: function(destination, filter = {ignoreCreeps: false,reusePath: 5}){
				    if(!this.fatigue){
    					if (this.isBlocked()){
    					    return this.moveTo(destination,filter);
    					}else{
    					    let err = this.moveTo(destination,{ignoreCreeps: true,reusePath: 150,maxOps: 8000});
    					    if (err != ERR_NO_PATH){
    						    return err;
    					    }else{
    					        delete this.memory._move;
    					        return this.moveTo(destination,{ignoreCreeps: false,reusePath: 6});
    					    }
    					}
				    }else{
					    return ERR_TIRED;
					}
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Creep moves to a distant room target, using map.findRoute as simple pathfinder
			* Returns creep.moveTo() but cannot move to x,y coordinates - use roomPos instead
			* @return {Boolean} 
			*/
			"journeyTo": {
				value: function(destination, filter = {ignoreCreeps: false,reusePath: 50,ignoreRoads: true}){
					let targetRoomName = destination.roomName || destination.pos.roomName;
					if (!this.memory._move){
						this.memory._move = {};
					}
					if (this.room.name != targetRoomName && (!this.memory._move.rooms || this.memory._move.rooms[0].room != targetRoomName)){
						//this.memory._move.rooms = [{'exit': 0, 'room': targetRoomName}];
						this.memory._move.rooms = (Game.map.findRoute(this.pos.roomName,targetRoomName,{
						    routeCallback(roomName){//, fromRoomName) {
                                if(ROOM_BLACKLIST[roomName]) {    // avoid this room
                                    return Infinity;
                                }
                                return 1;
                            }
						})).reverse();
						if (!this.memory._move.rooms){
							delete this.memory._move.rooms;
						}
					}
					if (this.memory._move.rooms){
						if (this.room.name == this.memory._move.rooms[this.memory._move.rooms.length-1].room){
							this.memory._move.rooms.pop();
						}
						if (this.memory._move.rooms.length > 1){
							let nextHop;
							switch(this.memory._move.rooms[this.memory._move.rooms.length-2].exit){ // aim for room after next room
								case FIND_EXIT_TOP   : nextHop = new RoomPosition(25, 1,this.memory._move.rooms[this.memory._move.rooms.length-2].room); break;
								case FIND_EXIT_RIGHT : nextHop = new RoomPosition(48,25,this.memory._move.rooms[this.memory._move.rooms.length-2].room); break;
								case FIND_EXIT_BOTTOM: nextHop = new RoomPosition(25,48,this.memory._move.rooms[this.memory._move.rooms.length-2].room); break;
								case FIND_EXIT_LEFT  : nextHop = new RoomPosition( 1,25,this.memory._move.rooms[this.memory._move.rooms.length-2].room); break;
								default: nextHop = destination;
							}
							
							if(!this.fatigue){
    							if (this.isBlocked()){
            					    return this.moveTo(nextHop,filter);
            					}else{
            					    let err = this.moveTo(nextHop,filter);
            					    if (err != ERR_NO_PATH){
            						    return err;
            					    }else{
            					        delete this.memory._move;
            					        return this.moveTo(nextHop,filter);
            					    }
            					}
        					}else{
            					    return ERR_TIRED;
            				}
							
							
							
						}else{
							
							if(!this.fatigue){
    							if (this.isBlocked()){
            					    return this.moveTo(destination,filter);
            					}else{
            					    let err = this.moveTo(destination,filter);
            					    if (err != ERR_NO_PATH){
            						    return err;
            					    }else{
            					        delete this.memory._move;
            					        return this.moveTo(destination,filter);
            					    }
            					}
					    	}else{
        					    return ERR_TIRED;
            				}
							
							
						}
					}else{
						if(this.memory._move.rooms){
							delete this.memory._move.rooms;
						}
						
						
						if (this.isBlocked()){
    					    return this.moveTo(destination,filter);
    					}else{
    					    let err = this.moveTo(destination,filter);
    					    if (err != ERR_NO_PATH){
    						    return err;
    					    }else{
    					        delete this.memory._move;
    					        return this.moveTo(destination,filter);
    					    }
    					}
						
						
					}
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Returns if creep path is blocked - based on creep is standing still
			* The idea is: if a creep stands still, its .memory._move.path variable stays the same length. 
			* If the creep is moving, the length of .memory._move.path decreases.
			* So if you add the last two path.length and their sum is equal to the actuall path.length two times
			* the creep must be standing still the last 2 ticks.
			* @return {Boolean} 
			*/
			"isBlocked" : {
				value: function(){
					let bool = false;
					if (this.memory._move && this.memory._move.path){
						let pathLength = (this.memory._move.path.length + this.memory._move.path.length)+this.fatigue || this.fatigue;
						if (pathLength == this.memory._move.pathLength || this.memory._move.path == ""){
							bool = true;
						}else if (pathLength < this.memory._move.pathLength){
							this.memory._move.pathLength = this.memory._move.path.length;
						}else{
							this.memory._move.pathLength += this.memory._move.path.length;
						}
					}
					return bool;
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Creep leaves border iff its position is on exit zone
			* @param {Number} gap
			* @return {Number} return creep.move()
			*/
			"leaveBorder" : {
				value: function(gap = 0){ // default gap is 0
					if (this.pos.x <= 0 + gap) return this.move(RIGHT);
					else if(this.pos.y <= 0 + gap) return this.move(BOTTOM);
					else if(this.pos.x >= 49 - gap) return this.move(LEFT);
					else if(this.pos.y >= 49 - gap) return this.move(TOP);
				},
				writable: true,
				enumerable: true
			},	

			/**
			* MAKES SCREEPS PINK AGAIN - signs controllers with punny messages, if not yet signed by our pink alliance
			* @return {Boolean} returns signing is necessary?
			*/
			"makeScreepsPinkAgain" : {
				value: function(){// default range is 1
					let bool = false;
					if (this.room.controller){
						if (!this.room.controller.sign || (Memory.globals && Memory.globals.ally && Memory.globals.ally[this.room.controller.sign.username] === undefined)){
							switch(Game.time%3) {
							case 0:
								this.say("one",true);
								break;
							case 1:
								this.say("of",true);
								break;
							case 2:
								this.say("us",true);
								break;
							}
							bool = true;
							if (!this.inRangeTo(this.room.controller)){
								this.travelTo(this.room.controller);
							}else{
								let i = parseInt(Math.random()*PUNY_PUN_ARRAY.length);
								this.signController(this.room.controller,PUNY_PUN_ARRAY[i]);
							}
						}
					}
					return bool;
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Clears controller.sign
			* @return {Boolean} returns clearing is necessary?
			*/
			"clearSign" : {
				value: function(){// default range is 1
					let bool = false;
					if (this.room.controller){
						if (this.room.controller.sign){
							bool = true;
							if (!this.inRangeTo(this.room.controller)){
								this.moveTo(this.room.controller);
							}else{
								this.signController(this.room.controller,"");
							}
						}
					}
					return bool;
				},
				writable: true,
				enumerable: true
			},
	
			/** NEEDS TESTING // TODO
			* Reserves specific amount of specific resource for set amount of ticks on given container
			* Uses StructureStorage.prototype.reserveResource = function(objectId,resource,amount,ticks)
			*  or StructureContainer.prototype.reserveResource = function(objectId,resource,amount,ticks)
			* @param {Object} container or storage
			* @param {String} resource
			* @param {Number} amount
			* @param {Number} ticks
			* @return {Number} errorCode
			*/
			"reserveResource" : {
				value: function(container,resource=RESOURCE_ENERGY,amount=this.carryCapacity,ticks=50){
					if (container.structureType && (container.structureType == STRUCTURE_STORAGE || container.structureType == STRUCTURE_CONTAINER)) {
						container.reserveResource(this.id,resource,amount,ticks);
					}else {
						return ERR_INVALID_TARGET;
					}
				},
				writable: true,
				enumerable: true
			},
			
			/** NEEDS TESTING // TODO
			* Creep moves to target container and reserves an amount of resource
			* Uppon reaching target the creep withdraws the reserved resource amount and cancels the reservation
			* Used by screep.reserveResource(container,[resource],[amount],[ticks])
			* @param {Number} objectId of reserver
			* @param {String} resource
			* @param {Number} amount
			* @param {Number} ticks
			* @return {Number} errorCode
			*/
			"gather" : {
				value: function(container,resource=RESOURCE_ENERGY,amount=this.carryCapacity,ticks=50){
					let errorCode = OK;
					//TODO
					return errorCode;
				},
				writable: true,
				enumerable: true
			},
			
			"chargeController" : {
				value: function(controller){
					let errorCode = OK;
					//TODO
					return errorCode;
				},
				writable: true,
				enumerable: true
			},
			
			"park" : {
			    value: function(){return true},
			    /*
				value: function(){
					onRoad = this.pos.lookFor(LOOK_STRUCTURES).filter((s) => s.structureType == STRUCTURE_ROAD).length;
					if(onRoad > 0){
					    var x = this.pos.x;
					    var xUBorder = Math.min(x,48);
					    var y = this.pos.y;
					    var yLBorder = Math.max(y,2);
					    var yUBorder = Math.min(y,48);
					    for(i=Math.max(x,2);i<xUBorder;i++){
					        for(j=yUBorder;j<yUBorder;j++){
					            this.say("hi")
					            if(x != i || y != j){
					                if(!this.room.lookForAt(LOOK_STRUCTURES,i,j).filter((s)=> s.structureType != STRUCTURE_RAMPART).length){
					                    this.move(getDirectionTo(i,j));
					                    if(this.pos.x == i && this.pos.y == j){
					                        this.memory.pX=x;
					                        this.memory.pY=y;
					                        return true;
					                    }else{
					                        return false;
					                    }
					                }
					            }
					        }
					    }
					}
				},*/
				writable: true,
				enumerable: true
			},
			
			"unpark" : {
			    value: function(){return true},/*
				value: function(force){
				    if(force){
					    delete this.memory.pX;
					    delete this.memory.pY;
					    return true;
			    	}else if(this.memory.pX && this.memory.pY){
					    this.move(getDirectionTo(this.memory.pX,this.memory.pY));
					    if(this.pos.x == this.memory.pX && this.pos.y ==this.memory.pY){
					        delete this.memory.pX;
    					    delete this.memory.pY;
    					    return true;
					    }else{
					        return false;
					    }
					}else{
				        return true;
				    }
				},*/
				writable: true,
				enumerable: true
			},
			
			"getRandomName" : {
				value: function(){
					let names1 = ["Jackson", "Aiden", "Liam", "Lucas", "Noah", "Mason", "Jayden", "Ethan", "Jacob", "Jack", "Caden", "Logan", "Benjamin", "Michael", "Caleb", "Ryan", "Alexander", "Elijah", "James", "William", "Oliver", "Connor", "Matthew", "Daniel", "Luke", "Brayden", "Jayce", "Henry", "Carter", "Dylan", "Gabriel", "Joshua", "Nicholas", "Isaac", "Owen", "Nathan", "Grayson", "Eli", "Landon", "Andrew", "Max", "Samuel", "Gavin", "Wyatt", "Christian", "Hunter", "Cameron", "Evan", "Charlie", "David", "Sebastian", "Joseph", "Dominic", "Anthony", "Colton", "John", "Tyler", "Zachary", "Thomas", "Julian", "Levi", "Adam", "Isaiah", "Alex", "Aaron", "Parker", "Cooper", "Miles", "Chase", "Muhammad", "Christopher", "Blake", "Austin", "Jordan", "Leo", "Jonathan", "Adrian", "Colin", "Hudson", "Ian", "Xavier", "Camden", "Tristan", "Carson", "Jason", "Nolan", "Riley", "Lincoln", "Brody", "Bentley", "Nathaniel", "Josiah", "Declan", "Jake", "Asher", "Jeremiah", "Cole", "Mateo", "Micah", "Elliot"]
				let names2 = ["Sophia", "Emma", "Olivia", "Isabella", "Mia", "Ava", "Lily", "Zoe", "Emily", "Chloe", "Layla", "Madison", "Madelyn", "Abigail", "Aubrey", "Charlotte", "Amelia", "Ella", "Kaylee", "Avery", "Aaliyah", "Hailey", "Hannah", "Addison", "Riley", "Harper", "Aria", "Arianna", "Mackenzie", "Lila", "Evelyn", "Adalyn", "Grace", "Brooklyn", "Ellie", "Anna", "Kaitlyn", "Isabelle", "Sophie", "Scarlett", "Natalie", "Leah", "Sarah", "Nora", "Mila", "Elizabeth", "Lillian", "Kylie", "Audrey", "Lucy", "Maya", "Annabelle", "Makayla", "Gabriella", "Elena", "Victoria", "Claire", "Savannah", "Peyton", "Maria", "Alaina", "Kennedy", "Stella", "Liliana", "Allison", "Samantha", "Keira", "Alyssa", "Reagan", "Molly", "Alexandra", "Violet", "Charlie", "Julia", "Sadie", "Ruby", "Eva", "Alice", "Eliana", "Taylor", "Callie", "Penelope", "Camilla", "Bailey", "Kaelyn", "Alexis", "Kayla", "Katherine", "Sydney", "Lauren", "Jasmine", "London", "Bella", "Adeline", "Caroline", "Vivian", "Juliana", "Gianna", "Skyler", "Jordyn"]
				let namesCombined = _.flatten(_.map(names1, function(v, i) { return [v, names2[i]]; }));
				if(!Memory.creepindex || Memory.creepindex >= namesCombined.length) {
					Memory.creepindex = 0
				}else{
					Memory.creepindex++
				}
				return namesCombined[Memory.creepindex % namesCombined.length];
				},
				writable: true,
				enumerable: true
			}
		});

	/*
	* FLAG
	*/

	/*
	* MINERAL
	*/
		Object.defineProperties(Mineral.prototype,{
			'memory' : {
				get: function() {
					if (this.room.memory.minerals === undefined) {
						this.room.memory.minerals = {};
					}
					if (this.room.memory.minerals[this.id] === undefined) {
						this.room.memory.minerals[this.id] = {};
					}
					return this.room.memory.minerals[this.id];
				},
				set: function(v) {
					return _.set(Memory.rooms[this.room.name], 'minerals.' + this.id, v);
				},
				configurable: true,
				enumerable: false
			}
		});

	/*
	* NUKE
	*/

	/*
	* RESOURCE
	*/
		Object.defineProperties(Resource.prototype,{
			'memory' : {
				get: function() {
					if (this.room.memory.resources === undefined) {
						this.room.memory.resources = {};
					}
					if (this.room.memory.resources[this.id] === undefined) {
						this.room.memory.resources[this.id] = {};
					}
					return this.room.memory.resources[this.id];
				},
				set: function(v) {
					return _.set(Memory.rooms[this.room.name], 'resources.' + this.id, v);
				},
				configurable: true,
				enumerable: false
			}
		});

	/*
	* SOURCE
	*/
		Object.defineProperties(Source.prototype,{
			
			/**
			* Initializes, sets and gets source memory
			* @param {obj} v
			* @return {obj} Memory.rooms[this.room.name].sources[this.id]
			*/
			'memory' : {
				get: function() {
					if (this.room.memory.sources === undefined) {
						this.room.memory.sources = {};
					}
					if (this.room.memory.sources[this.id] === undefined) {
						this.room.memory.sources[this.id] = {};
					}
					return this.room.memory.sources[this.id];
				},
				set: function(v) {
					return _.set(Memory.rooms[this.room.name], 'sources.' + this.id, v);
				},
				configurable: true,
				enumerable: false
			},
			
			/**
			* Initializes and gets source slots
			* @return {Number} Memory.rooms[this.room.name].sources[this.id].slots
			*/
			'slots' : {
				get: function() {
					if (this.room.memory.sources === undefined) {
						this.room.memory.sources = {};
					}
					if (this.room.memory.sources[this.id] === undefined) {
						this.room.memory.sources[this.id] = {};
					}
					if (this.room.memory.sources[this.id].slots === undefined || this.room.memory.sources[this.id].slotsUsed === undefined) {
						let count = 0;
						for (let x=-1;x<2;x++){
							for (let y=-1;y<2;y++){
								if ((this.room.lookForAt('terrain',this.pos.x+x,this.pos.y+y) == 'wall') && !(x==0 && y==0)){ //Check for walls around source
									count = count+1;
								}
							}
						}
						this.room.memory.sources[this.id].slots = 8-count;
						this.room.memory.sources[this.id].slotsUsed = 0;
					}
					return this.room.memory.sources[this.id].slots;
				},
				configurable: true,
				enumerable: false
			},
						
			/**
			* Checks if source has free slots for creeps to harvest
			* @return {Boolean} or undefined
			*/
			"hasFreeSlots" : {
				value: function(){
					if (this.room // Check if memory entrys exist
						&& this.room.memory.sources 
						&& this.room.memory.sources[this.id]
						&& this.room.memory.sources[this.id].slots
						&& this.room.memory.sources[this.id].harvesters)
					{
						return this.room.memory.sources[this.id].slots > Object.keys(this.room.memory.sources[this.id].harvesters).length
					}else {
						if (this.room.memory.sources === undefined) {
							this.room.memory.sources = {};
						}
						if (this.room.memory.sources[this.id] === undefined) {
							this.room.memory.sources[this.id] = {};
						}
						this.room.memory.sources[this.id].harvesters = {}
						return true;
					}
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Adds creepName to room.memory.sources
			* @param {String} creepName
			* @return {Boolean} 
			*/
			"occupy" : {
				value: function(creepName){
					if (this.hasFreeSlots()){
						this.room.memory.sources[this.id].harvesters.push(creepName);
						return true;
					}else{
						return false;
					}
				},
				writable: true,
				enumerable: true
			},
			
			/**
			* Removes creep with given name from room.memory.sources
			* @param {String} creepName
			* @return {Boolean} 
			*/
			"deOccupy" : {
				value: function(creepName){
					if (this.room // Check if memory entrys exist
						&& this.room.memory.sources 
						&& this.room.memory.sources[this.id]
						&& this.room.memory.sources[this.id].harvesters)
					{
						this.room.memory.sources[this.id].harvesters.pop(creepName);
						return true;
					}
					else{
						return false;
					}
				},
				writable: true,
				enumerable: true
			}
		});

	/*
	* STUCTURE
	*/
		Object.defineProperties(Structure.prototype,{
			'memory' : {
				get: function() {
					if (this.room.memory.structures === undefined) {
						this.room.memory.structures = {};
					}
					if (this.room.memory.structures[this.structureType] === undefined) {
						this.room.memory.structures[this.structureType] = {};
					}
					if (this.room.memory.structures[this.structureType][this.id] === undefined) {
						this.room.memory.structures[this.structureType][this.id] = {};
					}
					return this.room.memory.structures[this.structureType][this.id];
				},
				set: function(v) {
					return _.set(Memory, this.room.memory.structures[this.structureType][this.id], v);
				},
				configurable: true,
				enumerable: false
			}
		});

	/*
	* OWNED_STRUCTURE
	*/

	/*
	* STRUCTURE_CONTROLLER
	*/
	Object.defineProperties(StructureController.prototype,{
	    'getLink' : {
    		    value: function(body,name){
    		        if(this.spawning == null && !this.inactive){
                        return this.canCreateCreep(body,"_cr");
    		        }else{
    		            return ERR_BUSY;
    		        }
    		    },
    			writable: true,
    			enumerable: false
    		},
	});

	/*
	* STRUCTURE_EXTENSION
	*/

	/*
	* STRUCTURE_EXTRACTOR
	*/

	/*
	* STRUCTURE_KEEPER_LAIR
	*/

	/*
	* STRUCTURE_LAB
	*/

	/*
	* STRUCTURE_LINK
	*/

	/*
	* STRUCTURE_NUKER
	*/

	/*
	* STRUCTURE_OBSERVER
	*/

	/*
	* STRUCTURE_POWER_BANK
	*/

	/*
	* STRUCTURE_POWER_SPAWN
	*/

	/*
	* STRUCTURE_RAMPART
	*/

	/*
	* STRUCTURE_SPAWN
	*/
		Object.defineProperties(StructureSpawn.prototype,{
			'roomMemory' : {
				get: function() {
					if (this.room.memory.structures === undefined) {
						this.room.memory.structures = {};
					}
					if (this.room.memory.structures[this.structureType] === undefined) {
						this.room.memory.structures[this.structureType] = {};
					}
					if (this.room.memory.structures[this.structureType][this.id] === undefined) {
						this.room.memory.structures[this.structureType][this.id] = {};
					}
					return this.room.memory.structures[this.structureType][this.id];
				},
				set: function(v) {
					if (this.room.memory.structures === undefined) {
						this.room.memory.structures = {};
					}
					if (this.room.memory.structures[this.structureType] === undefined) {
						this.room.memory.structures[this.structureType] = {};
					}
					if (this.room.memory.structures[this.structureType][this.id] === undefined) {
						this.room.memory.structures[this.structureType][this.id] = {};
					}
					return _.set(Memory, this.room.memory.structures[this.structureType][this.id], v);
				},
				configurable: true,
				enumerable: false
			},
			
			
			'canSpawnCreep' : {
    		    value: function(body,name){
    		        if(this.spawning == null && !this.inactive){
                        return this.canCreateCreep(body,"_cr");
    		        }else{
    		            return ERR_BUSY;
    		        }
    		    },
    			writable: true,
    			enumerable: false
    		},
			
    		'spawnCreep' : {
    		    value: function(body,name,memory){
    		        if(this.spawning == null && this.inactive == undefined){
        		        let _name = getName(name);
    		            while(Game.creeps[_name]){
    		                _name = getName(name);
                        }
                        let err = this.createCreep(body,_name,memory);
                        if(typeof err == "string"){
                            this.inactive = false;
                        }
                        return err;
    		        }else{
    		            return ERR_BUSY;
    		        }
    		    },
    			writable: true,
    			enumerable: false
    		},
            
			
			"enQueueCreep" : {
				value: function(body, name,memory,priority){
					//TODO
					return false;
				},
				writable: true,
				enumerable: true
			},
			
			"isCreepInQueue" : {
				value: function(body, name,memory,priority){
					//TODO
					return false;
				},
				writable: true,
				enumerable: true
			},
			
			"deQueueCreep" : {
				value: function(body, name,memory,priority){
					//TODO
					return false;
				},
				writable: true,
				enumerable: true
			}
		});

	/*
	* STRUCTURE_STORAGE
	*/
		Object.defineProperties(StructureStorage.prototype,{
			"reserveResource" : {
				/** NEEDS TESTING
				* Identical to StructureContainer.prototype.reserveResource
				* Reserves specific amount of specific resource for set amount of ticks
				* Used by screep.reserveResource(container,[resource],[amount],[ticks])
				* @param {Number} objectId (of reserver)
				* @param {String} resource
				* @param {Number} amount
				* @param {Number} ticks
				* @return {Number} errorCode
				*/
				value: function(objectId,resource,amount,ticks){
					let errorCode = OK;
					//TODO
					return errorCode;
				},
				writable: true,
				enumerable: true
			},
			
			"reserveResource" : {
				/** NEEDS TESTING
				* Checks for expired reservations and cancels them
				* Substracts stored resource with reserved resource
				* Identical to StructureContainer.prototype.availableResource
				* @param {String} resource
				* @return {Number} availableRes
				*/
				value: function(resource){
					let availableRes = 0;
					//TODO
					return availableRes;
				},
				writable: true,
				enumerable: true
			}
		});
	
	/*
	* STRUCTURE_TERMINAL
	*/

	/*
	* STRUCTURE_TOWER
	*/

	/*
	* STRUCTURE_CONTAINER
	*/
		Object.defineProperties(StructureContainer.prototype,{
			"reserveResource" : {
				/** NEEDS TESTING
				* Identical to StructureContainer.prototype.reserveResource
				* Reserves specific amount of specific resource for set amount of ticks
				* Used by screep.reserveResource(container,[resource],[amount],[ticks])
				* @param {Number} objectId (of reserver)
				* @param {String} resource
				* @param {Number} amount
				* @param {Number} ticks
				* @return {Number} errorCode
				*/
				value: function(objectId,resource,amount,ticks){
					let errorCode = OK;
					//TODO
					return errorCode;
				},
				writable: true,
				enumerable: true
			},
			
			"reserveResource" : {
				/** NEEDS TESTING
				* Checks for expired reservations and cancels them
				* Substracts stored resource with reserved resource
				* Identical to StructureContainer.prototype.availableResource
				* @param {String} resource
				* @return {Number} availableRes
				*/
				value: function(resource){
					let availableRes = 0;
					//TODO
					return availableRes;
				},
				writable: true,
				enumerable: true
			}
		});

	/*
	* STRUCTURE_PORTAL
	*/

	/*
	* STRUCTURE_ROAD
	*/

	/*
	* STRUCTURE_WALL
	*/
}