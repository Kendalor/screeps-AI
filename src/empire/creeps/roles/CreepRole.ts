export class CreepRole {
    
	public creep: Creep;
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {};
    
    constructor(creep: Creep){
        this.creep=creep;
    }

    public run(): void {
        global.logger.debug("Running: Role " + this.creep.memory.role + " for Creep " + this.creep.name );
		if(this.creep.memory.job === undefined ) { 
            global.logger.debug("Running: Role " + this.creep.memory.role + "for Creep " + this.creep.name + ": Starting Loop" );
            for(const job of Object.keys(this.jobs)) {
                global.logger.debug("Run Condition for: "+ job);
                if( this.creep.memory.job === null || this.creep.memory.job === undefined){
                    global.logger.debug("Run Condition for: "+ job + " Job still not set");
                    if(this.jobs[job].runCondition(this.creep)) {
                        global.logger.debug("Run Condition for Job: " + job + " is True" );
                        const target: string | null = this.jobs[job].getTargetId(this.creep);
                        if(target != null) {
                            global.logger.debug("Target Condition for Job: " + job + " is True" );
                            this.creep.memory.targetId = target;
                            this.setJob(job);
                            this.run();
                        }
                    }
                } 
            }
        } else if( this.jobs[this.creep.memory.job] == null){
            global.logger.info("Running: " + this.creep.memory.role + " with Name " + this.creep.name + " : INVALID JOB FOUND: " + this.creep.memory.job);
            delete this.creep.memory.job;
            this.run();
        } else if(this.jobs[this.creep.memory.job] != null) {
            if( this.creep.memory.job !== undefined ) {
                this.jobs[this.creep.memory.job].run(this.creep);
            }
        }

    }
    public setJob(j: string): void {
		this.creep.memory.job = j;
	}
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		return [] as BodyPartConstant[] ;
		
	}

}