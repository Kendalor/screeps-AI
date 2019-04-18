import { Job } from "./Job";

export class Upgrade extends Job{


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy > 0 && this.getTargetId(creep) !== null;
    }

    public static getTargetId(creep: Creep): string | null {
        return creep.room.controller!.id;
    }

    public static run(creep: Creep): void {
        if(this.runCondition(creep)){
            const target: StructureController | null = Game.getObjectById(creep.memory.targetId);
            if(target !== null) {
                const rangeTo = creep.pos.getRangeTo(target);
                switch(rangeTo){
                    case 3:
                        creep.moveTo(target);
                    case 1:
                        creep.upgradeController(target);
                        break;
                    default:

                        creep.moveTo(target);
                }
            } else {
                this.cancel(creep);
            } 
        } else {
            this.cancel(creep);
        }
    }

    public static cancel(creep: Creep): void {
        if(creep.memory.job === 'Upgrade'){
            creep.memory.job = undefined;
            creep.memory.targetId = undefined;
		}
    }

    
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        


        /*
        // CONDITIONS START
        if (this.creep.carry.energy > 0){
			if (!this.creep.memory.job){
                // CONDITION END

                // SETUP FOR JOB
				this.anounceJob(this.creep,'Upgrade');
                this.creep.memory.targetId=this.creep.room.controller!.id;
                
                // END SETUP FOR JOB
			}
			if (this.creep.memory.job === 'Upgrade'){

                // EXECUTION OF JOB
				const target: StructureController | null = Game.getObjectById(this.creep.memory.targetId);
				if(target !== null) {
					const rangeTo = this.creep.pos.getRangeTo(target);
					switch(rangeTo){
						case 3:
							this.creep.travelTo(target);
						case 1:
							this.creep.upgradeController(target);
							break;
						default:
	
							this.creep.travelTo(target);
					}
				}
            }
            // END EXECUTION OF JOB
        } 
        

        // PART OF RECHARGE JOB ( Which is never used )
		if (( this.creep.carry.energy === 0 || (this.creep.memory.workModules && this.creep.carry.energy < this.creep.memory.workModules) ) && this.creep.memory.job === 'Upgrade') {
			if (!(!this.creep.memory.cFlagId)){
				delete this.creep.memory.cFlagId;
			}
			this.idle(this.creep);
        }
        */
        // WTF ?!
}