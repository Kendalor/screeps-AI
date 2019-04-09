

export interface SpawnConfig {
    currentPopulation:{ [role: string]: number};
    targetPopulation:{ [role: string]: number};
    presets: {[role: string]: BodyPartConstant[]};
}

export class SpawnConfigAutoSpawn implements SpawnConfig {

    public roles = ["miner","hauler", "maintenance", "supplier", "upgrader", "defender"];
    public currentPopulation:{ [role: string]: number} = {};
    public targetPopulation:{ [role: string]: number} = {};
    public presets: {[role: string]: BodyPartConstant[]} = {};

    constructor(room: Room) {
        if(room.memory.SpawnConfigAutoSpawn === undefined) {
            console.log("Room Memory SpawnConfigAUtospawn is undefined");
            room.memory.SpawnConfigAutoSpawn={targetPopulation: {}, currentPopulation: {}, presets: {}};
            this.initValues(room);
            this.readCurrentPopulationFromRoom(room);
            this.readTargetPopulationFromRoom(room);
            this.readPresetsFromRoom(room);
        } else {
            if(Game.time % 10 === 0 ){
                this.readTargetPopulationFromRoom(room);
                this.readPresetsFromRoom(room);
            } else {
                this.readTargetPopulationFromMemory(room);
                this.readPresetsFromMemory(room);
            }
            this.readCurrentPopulationFromRoom(room);
        }

    }

    public readPresetsFromRoom(room: Room){

        // MINER
    
        let energyCap: number = room.energyCapacityAvailable;
        let moveParts: number = 1;
        let carryParts: number = 1;
        let workParts: number = 2;

        if (energyCap >= 950) {moveParts=6;carryParts=1;workParts=6;}
        if (energyCap < 950) {moveParts=1;carryParts=1;workParts=6;}
        if (energyCap < 800) {moveParts=1;carryParts=1;workParts=5;}
        if (energyCap < 700) {moveParts=1;carryParts=1;workParts=4;}
        if (energyCap < 500) {moveParts=2;carryParts=1;workParts=1;}

        if (this.currentPopulation.miner === 0 && this.currentPopulation.maintance === 0 && room.energyAvailable < energyCap) {
            moveParts=1;
            carryParts=1;
            workParts=2;
        }

        room.memory.SpawnConfigAutoSpawn.presets.miner = this.presets.miner = Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));

        // HAULER

        let carryCap: number = 10;
        if (carryCap < 10) {
            carryCap += 2;
        }

        moveParts= Math.min(Math.max(2,energyCap/150),Math.ceil(carryCap/2));
        carryParts = moveParts*2;

        if (this.currentPopulation.hauler === 0 && room.memory.activeCreepRoles.maintance === 0 && room.energyAvailable < energyCap) {
            moveParts=2;
            carryParts=4;
            this.presets.hauler = Array(carryParts).fill(CARRY).concat(Array(moveParts).fill(MOVE));
        }else{
            let partArray1: BodyPartConstant[] = [];
            for (let i = 0; i < moveParts; i++){
                partArray1 = partArray1.concat([CARRY,CARRY,MOVE]);
            }
            room.memory.SpawnConfigAutoSpawn.presets.hauler =this.presets.hauler = partArray1;
        }


        // MAINTENANCE

            energyCap = Math.min(room.energyCapacityAvailable,1200);
            if (room.memory.activeCreepRoles.hauler === 0 && room.memory.activeCreepRoles.maintance === 0 && room.energyAvailable < energyCap) {
                energyCap = Math.min(room.energyAvailable,1500);
            }
                
            moveParts = Math.min(Math.max(1,energyCap/200),4);
            carryParts = moveParts;
            workParts = moveParts;
            if (energyCap <= 300) {
                moveParts=2;carryParts=1;workParts=1;
            } else {
                let partArray1: BodyPartConstant[] = [];
                for (let i = 0; i < moveParts; i++){
                    partArray1= partArray1.concat([WORK,CARRY,MOVE]);
                }
                this.presets.maintenance = partArray1;
            }
            room.memory.SpawnConfigAutoSpawn.presets.maintenance = this.presets.maintenance = Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));



        // UPGRADER
        
            energyCap = room.energyCapacityAvailable;
            workParts = Math.max(1,((energyCap-100)/100));
            if (workParts > 15) {
                workParts = 15;
            }
            carryParts = ((energyCap-(100*workParts)-50)/50);
            if (carryParts > 3) {
                carryParts = 3;
            }
            moveParts = ((energyCap-(100*workParts)-50*carryParts)/50);
            if (moveParts > 8) {
                moveParts = 8;
            }
            room.memory.SpawnConfigAutoSpawn.presets.upgrader = this.presets.upgrader = Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
        
        
        // DEFENDER

        energyCap = room.energyCapacityAvailable;
        moveParts = 2;
        let attackParts = 2;
        let toughParts = 0;

        if (energyCap >= 1050) {
            moveParts=5;toughParts=0;attackParts=10;
        }
        if (energyCap < 950) {
            moveParts=4;toughParts=0;attackParts=8;
        }
        if (energyCap < 800) {
            moveParts=4;toughParts=0;attackParts=7;
        }
        if (energyCap < 700) {
            moveParts=3;toughParts=0;attackParts=6;
        }
        if (energyCap < 500) {
            moveParts=2;toughParts=0;attackParts=2;
        }

        if (toughParts > 0){
            this.presets.defender = Array(toughParts).fill(TOUGH).concat(Array(moveParts).fill(MOVE)).concat(Array(attackParts).fill(ATTACK));
        }
        else {
            this.presets.defender = Array(moveParts).fill(MOVE).concat(Array(attackParts).fill(ATTACK));
        }

        // HAULER
        energyCap = Math.max(900, room.energyAvailable);
        moveParts= Math.min(16,Math.max(2,(((energyCap)/3)/50)));
        let partArray: BodyPartConstant[] = [];
        for (let i = 0; i < moveParts; i++){
            partArray = partArray.concat([CARRY,CARRY,MOVE]);
        }
        room.memory.SpawnConfigAutoSpawn.presets.hauler = this.presets.hauler = partArray;
    }

    public readPresetsFromMemory(room: Room) {
        for(const e of this.roles) {
            this.presets[e]= room.memory.SpawnConfigAutoSpawn.presets[e];
        }
    }
    

    public readCurrentPopulationFromRoom(room: Room): void {
        for(const e of this.roles) {
            this.currentPopulation[e]= room.memory.SpawnConfigAutoSpawn.currentPopulation[e] = room.find(FIND_MY_CREEPS).filter((creep) => creep.memory.role === e).length;
        }
    }

    public readTargetPopulationFromRoom(room: Room): void {
        if (room.storage === undefined) {
            room.memory.SpawnConfigAutoSpawn.targetPopulation.miner = this.targetPopulation.miner = 2;
            if(room.energyCapacityAvailable >= 700){
                room.memory.SpawnConfigAutoSpawn.targetPopulation.maintenance = this.targetPopulation.maintenance = 2*Object.keys(room.find(FIND_SOURCES)).length;
            }else if(room.energyCapacityAvailable >= 500){
                room.memory.SpawnConfigAutoSpawn.targetPopulation.maintenance = this.targetPopulation.maintenance = 5*Object.keys(room.find(FIND_SOURCES)).length;
            }else{
                room.memory.SpawnConfigAutoSpawn.targetPopulation.maintenance = this.targetPopulation.maintenance = 4*Object.keys(room.find(FIND_SOURCES)).length;
            }
            room.memory.SpawnConfigAutoSpawn.targetPopulation.upgrader = this.targetPopulation.upgrader = 1;
        } else {
            room.memory.SpawnConfigAutoSpawn.targetPopulation.miner = this.targetPopulation.miner = 2;
            if(room.controller!.level < 8){
                room.memory.SpawnConfigAutoSpawn.targetPopulation.upgrader = this.targetPopulation.upgrader = Math.min(Math.max( (room.storage.store[RESOURCE_ENERGY] / 30000 ) - 4, 0),6);
            }else{
                room.memory.SpawnConfigAutoSpawn.targetPopulation.upgrader = this.targetPopulation.upgrader = 1;
            }
            room.memory.SpawnConfigAutoSpawn.targetPopulation.maintenance = this.targetPopulation.maintenance = Math.ceil(1 + (Object.keys(room.find(FIND_MY_CONSTRUCTION_SITES)).length)/10) ; 
        }
        if(room.controller!.level > 5){
            room.memory.SpawnConfigAutoSpawn.targetPopulation.supplier = this.targetPopulation.supplier = 2;
        }
    }

    public readTargetPopulationFromMemory(room: Room): void {
        for(const e of this.roles) {
            this.targetPopulation[e]= room.memory.SpawnConfigAutoSpawn.targetPopulation[e];
        }
    }

    public initValues(room: Room): void {
        for(const e of this.roles) {
            this.targetPopulation[e]= room.memory.SpawnConfigAutoSpawn.targetPopulation[e] = 0;
            this.currentPopulation[e]= room.memory.SpawnConfigAutoSpawn.currentPopulation[e] = 0;
        }
    }
}