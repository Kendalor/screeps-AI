// CACHE REFRESH CONSTANTS

const HOSTILE_CREEP_REFRESH_TIME = 0;

const MY_CREEP_REFRESH_TIME = 5;
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
			* Returns timestam the object was last searched for
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
					let c = this.findCreeps();
					let m = this.findMinerals();
					let r = this.findResources();
					let s = this.findSources();
					let str = this.findStructures();
					return [cS.length,c.length,m.length,r.length,s.length,str.length];
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the constructionSites found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[ConstructionSite]} objectArray
			*/
			'findConstructionSites' : {
				value: function(filter) {
					let objectArray = this.find(FIND_CONSTRUCTION_SITES,filter);
					for (let i in objectArray){
						objectArray[i].memory;
					}
					this.setLastSeen("constructionSites");
					return objectArray;
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
						return objectArray;
					}else{
						return this.findConstructionSites();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Clears room constructionSites
			*/
			'clearConstructionSites' : {
				get: function() {
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
			
			/** 
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
			* Returns array of the creeps found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Creep]} objectArray
			*/
			'findCreeps' : {
				value: function(filter) {
					let objectArray = this.find(FIND_CREEPS,filter);
					for (let i in objectArray){
						objectArray[i].roomMemory;
					}
					this.setLastSeen("myCreeps");
					this.setLastSeen("hostileCreeps");
					return objectArray;
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
					if (this.lastSeen("myCreeps") == Game.time && this.lastSeen("hostileCreeps") == Game.time){
						let objectArray = this.hostileCreeps.concat(this.alliedCreeps).concat(this.myCreeps);
						return objectArray;
					}else{
						return this.findCreeps();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Creep]} objectArray
			*/
			'findHostileCreeps' : {
				value: function(filter) {
					let objectArray = this.find(FIND_HOSTILE_CREEPS,filter);
					for (let i in objectArray){
						objectArray[i].roomMemory;
					}
					this.setLastSeen("hostileCreeps");
					return objectArray.filter((c) => Memory.globals.friend[c.owner.username] == undefined);
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'hostileCreeps' : {
				get: function() {
					if (this.lastSeen("hostileCreeps") >= Game.time-HOSTILE_CREEP_REFRESH_TIME){
						let objectArray = [];
						if (this.memory && this.memory.hostileCreeps){
							for (let id in this.memory.hostileCreeps){
								let obj = Game.getObjectById(id);
								if (obj && Creep.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.hostileCreeps[id];
								}
							}
						}
						return objectArray;
					}else{
						return this.findHostileCreeps();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the allied creeps found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Creep]} objectArray
			*/
			'findAlliedCreeps' : {
				value: function(filter) {
					let objectArray = this.find(FIND_HOSTILE_CREEPS,filter);
					for (let i in objectArray){
						objectArray[i].roomMemory;
					}
					this.setLastSeen("hostileCreeps");
					return objectArray.filter((c) => Memory.globals.friend[c.owner.username]);
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps of allied players whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'alliedCreeps' : {
				get: function() {
					if (this.lastSeen("hostileCreeps") >= Game.time-HOSTILE_CREEP_REFRESH_TIME){
						let objectArray = [];
						if (this.memory && this.memory.alliedCreeps){
							for (let id in this.memory.alliedCreeps){
								let obj = Game.getObjectById(id);
								if (obj && Creep.prototype.isPrototypeOf(obj)){
									objectArray.push(obj);
								}else{
									delete this.memory.alliedCreeps[id];
								}
							}
						}
						return objectArray;
					}else{
						return this.findAlliedCreeps();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the your creeps found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Creep]} objectArray
			*/
			'findMyCreeps' : {
				value: function(filter) {
					let objectArray = this.find(FIND_MY_CREEPS,filter);
					for (let i in objectArray){
						objectArray[i].roomMemory;
					}
					this.setLastSeen("myCreeps");
					return objectArray;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the hostile creeps whose ids are saved in room memory
			* @return {[Creep]} objectArray
			*/
			'myCreeps' : {
				get: function() {
					if (this.lastSeen("myCreeps") >= Game.time-MY_CREEP_REFRESH_TIME){
						let objectArray = [];
						if (this.memory && this.memory.myCreeps){
							for (let id in this.memory.myCreeps){
								let obj = Game.getObjectById(id);
								if (obj && obj.pos.roomName == this.name && Creep.prototype.isPrototypeOf(obj) ){
									objectArray.push(obj);
								}else{
									delete this.memory.myCreeps[id];
								}
							}
						}
						return objectArray;
					}else{
						return this.findMyCreeps();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the minerals found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Mineral]} objectArray
			*/
			'findMinerals' : {
				value: function(filter) {
					let objectArray = this.find(FIND_MINERALS,filter);
					for (let i in objectArray){
						objectArray[i].memory;
					}
					this.setLastSeen("minerals");
					return objectArray;
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
						return objectArray;
					}else{
						return this.findMinerals();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the constructionSites found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Resource]} objectArray
			*/
			'findResources' : {
				value: function(filter) {
					let objectArray = this.find(FIND_DROPPED_RESOURCES,filter);
					for (let i in objectArray){
						objectArray[i].memory;
					}
					this.setLastSeen("resources");
					return objectArray;
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
						return objectArray;
					}else{
						return this.findResources();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the sources found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[Source]} objectArray
			*/
			'findSources' : {
				value: function(filter) {
					let objectArray = this.find(FIND_SOURCES,filter);
					for (let i in objectArray){
						objectArray[i].memory;
					}
					this.setLastSeen("sources");
					return objectArray;
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
						return objectArray;
					}else{
						return this.findSources();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the structures found in room and saves their id in room memory
			* @param {filter} filter
			* @return {[structure]} objectArray
			*/
			'findStructures' : {
				value: function(filter) {
					let objectArray = this.find(FIND_STRUCTURES,filter);
					for (let i in objectArray){
						if (objectArray[i].structureType == STRUCTURE_SPAWN){
							objectArray[i].roomMemory;
						}
						else{
							objectArray[i].memory;
						}
					}
					this.setLastSeen("structures");
					return objectArray;
				},
				writable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the sources whose ids are saved in room memory
			* @return {[Source]} objectArray
			*/
			'structures' : {
				get: function() {
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
						return objectArray;
					}else{
						return this.findStructures();
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns array of the extensions whose ids are saved in room memory
			* @return {[StructureExtensions]} objectArray
			*/
			'extensions' : {
				get: function() {
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
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_EXTENSION);
					}
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
						return obj;
					}else{
						this.findStructures();
						return this.extractor;
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_KEEPER_LAIR);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_LAB);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_LINK);
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** TODO
			* Returns the link positioned near room storage
			* @return {StructureLink} obj
			*/
			'storageLink' : {
				get: function() {
					let link;
					if (this.memory && this.memory.structures && this.memory.structures.link && this.memory.structures.link.storage){
						//link = 
					}
					
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
						return obj;
					}else{
						this.findStructures();
						return this.nuker;
					}
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
						return obj;
					}else{
						this.findStructures();
						return this.observer;
					}
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
						return obj;
					}else{
						this.findStructures();
						return this.powerBank;
					}
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
						return obj;
					}else{
						this.findStructures();
						return this.powerSpawn;
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the ramparts whose ids are saved in room memory
			* @return {[StructureRampart]} objectArray
			*/
			'ramparts' : {
				get: function() {
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
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_RAMPART);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_SPAWN);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_TOWER);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_CONTAINER);
					}
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
						return objectArray;
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_PORTAL);
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the roads whose ids are saved in room memory
			* @return {[StructureRoad]} objectArray
			*/
			'roads' : {
				get: function() {
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
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_ROAD);
					}
				},
				configurable: true,
				enumerable: false
			},
			
			/** 
			* Returns the constructed walls whose ids are saved in room memory
			* @return {[StructureWall]} objectArray
			*/
			'constructedWalls' : {
				get: function() {
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
					}else{
						return this.findStructures().filter((s) => s.structureType == STRUCTURE_WALL);
					}
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
					}else if(Memory.globals && Memory.globals.friend && Memory.globals.friend[this.owner.username]){
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
					}else if(Memory.globals && Memory.globals.friend && Memory.globals.friend[this.owner.username]){
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
			
			/**
			* Returns pos.inRangeTo(target,range) iff creep and target share a room, else returns false
			* @param {Object} target
			* @param {Number} range
			* @return {Boolean} 
			*/
			"inRangeTo" : {
				value: function(target,range = 1){// default range is 1
					if(this.pos.roomName == target.pos.roomName){ // same room ?
						return this.pos.inRangeTo(target,range);
					}else{
						return false;
					}
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
						if (!this.room.controller.sign || (Memory.globals && Memory.globals.friend && Memory.globals.friend[this.room.controller.sign.username] === undefined)){
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
								this.moveTo(this.room.controller);
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
					if (this.room.memory.sources[this.id].slots === undefined) {
						let count = 0;
						for (let x=-1;x<2;x++){
							for (let y=-1;y<2;y++){
								if ((this.room.lookForAt('terrain',this.pos.x+x,this.pos.y+y) == 'wall') && !(x==0 && y==0)){ //Check for walls around source
									count = count+1;
								}
							}
						}
						this.room.memory.sources[this.id].slots = 8-count;
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
						return this.room.memory.sources[this.id].slots > this.room.memory.sources[this.id].harvesters.length
					}else {
						return undefined;
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
			
			"createCustomCreep" : {
				value: function(spawnEnergyCap, creepType){
					//TODO
					return false;
				},
				writable: true,
				enumerable: true
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