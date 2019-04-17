import { Build } from "../jobs/Build";
import { Gather } from "../jobs/Gather";
import { Harvest } from "../jobs/Harvest";
import { Haul } from "../jobs/Haul";
import { Mine } from "../jobs/Mine";
import { Repair } from "../jobs/Repair";
import { Upgrade } from "../jobs/Upgrade";

export class Maintenance {
    // TODO
    
    public creep: Creep;
    public jobs: any = {Repair, Upgrade, Mine, Gather, Haul, Build, Harvest};
    constructor(creep: Creep) {
        this.creep = creep;
    }

    public run(): void {
        if (this.creep.memory.job === undefined) {
            if(this.creep.room.controller!.ticksToDowngrade < 5000){
				if (this.creep.carry.energy > 0){
					this.creep.memory.targetId=this.creep.room.controller!.id;
					this.setJob("Upgrade");
					this.run();
				}
			}
            
			// if(creep.room.memory.underAttack)
			//    this.repair(creep);
			if(this.creep.carry.energy > 0 ){
				let repairTargets: Structure[] = this.creep.room.roads.filter((structure) => structure.hits < structure.hitsMax-1500);
				if(!repairTargets.length && this.creep.room.energyCapacityAvailable>=1300){
					if(!this.creep.room.memory.structureHitsMin){
						this.creep.room.memory.structureHitsMin = 5000; 
					}
					const minHits = this.creep.room.memory.structureHitsMin;
					if(!repairTargets.length){
						repairTargets = this.creep.room.ramparts.filter((structure) => structure.hits < minHits);
					}
					if(!repairTargets.length){
						repairTargets = this.creep.room.constructedWalls.filter((structure) => structure.hits < minHits);
					}
					if(!repairTargets.length && minHits < 15000000){
						this.creep.room.memory.structureHitsMin += 1000; 
					}
				}
				if(repairTargets.length > 0){
					const repairTarget = this.creep.pos.findClosestByPath(repairTargets);
					if(repairTarget !== null){
						const type = repairTarget.structureType;
						if(type === STRUCTURE_RAMPART || type === STRUCTURE_WALL){
							this.creep.room.memory.structureHitsMin = repairTarget.hits;
						}
						this.creep.memory.job = "Repair";
						this.creep.memory.targetId = repairTarget.id;
						this.setJob("Repair");
						this.run();
					}
				}
			}
			this.setJob("Build");
			
			this.setJob("Haul");
			this.setJob("Upgrade");
			this.setJob("Salvage");
			this.setJob("Gather");
		}
		this.jobs[this.creep.memory.job](this.creep).run();
    }
    public setJob(j: string): void {
		this.creep.memory.job = j;
    }

}