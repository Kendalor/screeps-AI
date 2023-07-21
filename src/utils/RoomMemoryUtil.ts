import { RoomPlannerUtils } from "empire/operations/Operations/roomPlanner/RoomPlannerUtils";
import { MapRoom } from "./MapRoom";


export class RoomMemoryUtil {
    public static SCOUTING_INTERVALL = 100000;
    public static SCOUTING_INTERVALL_HIGHWAY = 3000;
    public static SCOUTING_INTERVALL_KEEPER = 200000;
    public static SCOUTING_INTERVALL_SKIP = 200000;
    public static MAX_COLONIZE_DISTANCE = 8;

    public static checkIfRoomNeedsScouting(roomName: string){
        if(!this.isRoomTypeSet(roomName)){
            this.setRoomType(roomName);
        }
        switch(Memory.rooms[roomName].roomType) {
            case 'NormalRoom':
                if(!this.isRoomUpToDate(roomName, RoomMemoryUtil.SCOUTING_INTERVALL)){
                    return true;
                } else {
                    if(!this.isBaseSet(roomName)){
                        return true;
                    }
                    if(!this.isResourcesSet(roomName)){
                        return true;
                    }
                }
                break;
            case 'HighwayRoom':
                if(!this.isRoomUpToDate(roomName, RoomMemoryUtil.SCOUTING_INTERVALL_HIGHWAY)){
                    return true;
                }
                break;
            case 'Intersection':
                if(!this.isRoomUpToDate(roomName, RoomMemoryUtil.SCOUTING_INTERVALL_HIGHWAY)){
                    return true;
                }
                break;
            case 'KeeperRoom':
                if(!this.isRoomUpToDate(roomName, RoomMemoryUtil.SCOUTING_INTERVALL_KEEPER)){
                    return true;
                } else {
                    if(!this.isResourcesSet(roomName)){
                        return true;
                    }
                }
                break;
        }
        return false;
    }
    public static skipRoom(roomName: string): void {
        Game.notify("Scouting: Skipped Room: " + roomName + " at Time: " + Game.time );
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.scouting == null){
                mem.scouting = {};
            }
            mem.scouting.lastSeen = Game.time;
        }

    }

    public static isRoomFriendly(roomName: string): boolean {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.owner != null){
                if(mem.owner !== 'Kendalor'){
                    return false;
                }
            }
        }
        return true;
    }

    public static getRoomsInMemory(): string[] {
        return Object.keys(Memory.rooms);
    }

    public static routeCallBack(roomName: string): number {
        const r = new MapRoom(roomName);
        if(!(Game.map.getRoomStatus(roomName).status == "normal")){
            return 254;
        }else if(r.isHighway() || r.isIntersection()){
            return 1;
        } else if( !RoomMemoryUtil.isRoomFriendly(roomName)){
            return 120;
        } else if(r.isKeeperRoom()) {
            return 30;
        } else {
            return 2;
        }
    }

    public static getRoomOwner(roomName: string): string | undefined {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.owner != null){
                return mem.owner;
            }
        }
        return undefined;
    }

    public static getNearestColonizeAbleRoom(roomName: string): string | undefined{
        const rooms = this.getColonizableRooms();
        console.log("Rooms able to COlonize: "+ rooms);
        let dist = 255;
        let out ;
        for( const r of rooms){
            const d = this.getDistance(roomName,r);
            if(dist > d  && d <= this.MAX_COLONIZE_DISTANCE){
                dist = d;
                out = r;
            }
        }
        return out;
    }

    public static isRoomColonizeAble(roomName: string): boolean {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.roomType === 'NormalRoom'){
                if(mem.owner == null){
                    if(mem.base != null){
                        if(mem.base.bunker === true){
                            if(mem.base.anchor != null){
                                if(mem.resources != null){
                                    if(mem.resources.sources.length === 2){
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    public static reserveRoom(roomName: string): void {
        const mem = Memory.rooms[roomName];
        console.log("RESERVE ROOM: " + roomName);
        if(mem != null){
            if(mem.roomType === 'NormalRoom'){
                if(mem.owner == null){
                    mem.owner = 'Kendalor';
                }
            }
        }
    }

    public static getDistance(from: string, to: string){
        const route =this.getRoute(from,to);
        if(route !== -2){
            return route.length;
        } else {
            return 254;
        }
    }

    public static getRoomReservation(roomName: string): ReservationDefinition | undefined {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.reservation != null){
                return mem.reservation;
            }
        }
        return undefined;
    }

    public static setRoomReservation(room: Room): void {
        if(this.isRoomTypeSet(room.name)){
            if(Memory.rooms[room.name].roomType === 'NormalRoom'){
                if(room.controller != null){
                    if(room.controller.reservation != null){
                        room.memory.reservation = room.controller.reservation;
                    } else {
                        delete room.memory.reservation;
                    }
                }
            }
        }
    }

    public static getRoute(from: string, to: string): Array<{exit: ExitConstant, room: string}> | ERR_NO_PATH {
        const route =Game.map.findRoute(from,to, {
            routeCallback: this.routeCallBack
        });
        return route;
    }

    public static findPath(from: RoomPosition, to: RoomPosition): RoomPosition[] | undefined{
        const allowedRooms = {[from.roomName]: true};
        const route =Game.map.findRoute(from.roomName,to.roomName, {
            routeCallback: this.routeCallBack
        });
        if(route !== -2){
            for(const r of route){
                allowedRooms[r.room] = true;
            }
            const path = PathFinder.search(from,to, {
                roomCallback(roomName: string){
                    if(allowedRooms[roomName] === true){
                        return true;
                    }else {
                        return false;
                    }
                }
            });
            if(path != null){
                return path.path;
            }
        }
        return undefined;
    }


    public static setRareResources(room: Room){
        const mem = room.memory;
        
        if(this.isRoomTypeSet(room.name)){
            const structures = room.find(FIND_STRUCTURES).filter(str => str.structureType === STRUCTURE_POWER_BANK);
            const powerBank = structures.pop() as StructurePowerBank | undefined;
            const deposit = room.find(FIND_DEPOSITS).pop() as Deposit | undefined;
            if(powerBank != null){

                if(powerBank != null){
                    Game.notify("Found Powerbank" + room.name);
                    if(mem.rareResources == null){
                        mem.rareResources = {};
                    }
                    mem.rareResources.power = {amount: powerBank.power, validUntil: powerBank.ticksToDecay+Game.time};
                    Game.notify("Wrote Powerbank to Memory: " + JSON.stringify(mem));
                }else {
                    delete mem.rareResources.deposit;
                } 
            }
            if(deposit != null){
                if(mem.rareResources == null){
                    mem.rareResources = {};
                }
                mem.rareResources.deposit = {tyoe: deposit.depositType, validUntil: deposit.ticksToDecay+Game.time}; 
            }
            if(deposit == null && powerBank == null){
                delete mem.rareResources;
            }
        }
    }

    public static setRoomMemory(room: Room): void {
            if(!this.isRoomTypeSet(room.name)){
                this.setRoomType(room.name);
            }
            switch(room.memory.roomType) {
                case 'NormalRoom':
                    if(!this.isRoomUpToDate(room.name, RoomMemoryUtil.SCOUTING_INTERVALL)){
                        this.setLastSeen(room);
                    }
                    if(!this.isBaseSet(room.name)){
                        this.setBase(room);
                    }
                    if(!this.isResourcesSet(room.name)){
                        this.setRessources(room);
                    }
                    this.setOwner(room);
                    this.setRoomReservation(room);
                    break;
                case 'HighwayRoom':
                    if(!this.isRoomUpToDate(room.name, RoomMemoryUtil.SCOUTING_INTERVALL_HIGHWAY)){
                        this.setLastSeen(room);
                        this.setRareResources(room);
                    }
                    break;
                case 'Intersection':
                    if(!this.isRoomUpToDate(room.name, RoomMemoryUtil.SCOUTING_INTERVALL_HIGHWAY)){
                        this.setLastSeen(room);
                        this.setRareResources(room);
                    }
                    break;
                case 'KeeperRoom':
                    if(!this.isRoomUpToDate(room.name, RoomMemoryUtil.SCOUTING_INTERVALL_KEEPER)){
                        this.setLastSeen(room);
                    }
                    if(!this.isResourcesSet(room.name)){
                        this.setRessources(room);
                    }
                    this.setOwner(room);
                    break;
            }
    }

    public static isRoomUpToDate(roomName: string, interval: number): boolean {
        const roomMemory = Memory.rooms[roomName];
        if(roomMemory != null){
            if(roomMemory.scouting != null){
                if(roomMemory.scouting.lastSeen != null){
                    if(Math.abs(Game.time - roomMemory.scouting.lastSeen) < interval){
                        // console.log("Room: "+ roomName + " last Seen: " + roomMemory.scouting.lastSeen + " is less than " + interval + " Gameticks past:  (seen-tick) " + (Math.abs(Game.time - roomMemory.scouting.lastSeen)) + "<" + interval );
                        return true;
                    }
                }
            }
        }
        return false;
    }


    public static getCostMatrix(roomName: string): CostMatrix {
        const mem = Memory.rooms[roomName];
        if(this.isCostMatrixSet(roomName)){
            return mem.costMatrix;
        } else {
            return PathFinder.CostMatrix;
        }
    }

    public static isCostMatrixSet(roomName: string): boolean {
        const mem = Memory.rooms[roomName];
        if(mem != null){
            if(mem.costMatrix != null){
                return true;
            }
        }
        return false;
    }

    

    public static isRoomTypeSet(roomName: string): boolean {
        if(Memory.rooms[roomName] != null){
            if(Memory.rooms[roomName].roomType != null){
                return true;
            }
        }
        return false;
    }

    public static isResourcesSet(roomName: string): boolean {
        if(this.isRoomTypeSet(roomName)){
            if(Memory.rooms[roomName].roomType === 'NormalRoom' || Memory.rooms[roomName].roomType === 'KeeperRoom' ){
                if(Memory.rooms[roomName].resources != null){
                    return true;
                }
            }
        }
        return false;
    }
    public static setOwner(room: Room): void {
        if(this.isRoomTypeSet(room.name)){
            if(Memory.rooms[room.name].roomType === 'NormalRoom'){
                if(room.controller != null){
                    if(room.controller.owner != null){
                        room.memory.owner = room.controller.owner.username;
                    } else {
                        delete room.memory.owner;
                    }
                }
            }
        }
    }

    public static getColonizableRooms(): string[] {
        return this.getRoomsInMemory().filter( s => this.isRoomColonizeAble(s));
        
    }



    public static isRoomNeutral(roomName: string){
        if(Memory.rooms[roomName].roomType === 'NormalRoom'){
            if(Memory.rooms[roomName].owner != null){
                if(Memory.rooms[roomName].owner !== 'Kendalor'){
                    return false;
                }
            }
        }
        return true;
    }

    public static setRessources(room: Room): void {
        if(this.isRoomTypeSet(room.name)){
            if(Memory.rooms[room.name].roomType === 'NormalRoom' || Memory.rooms[room.name].roomType === 'KeeperRoom' ){
                const sources = room.find(FIND_SOURCES);
                const minerals = room.find(FIND_MINERALS);
                room.memory.resources = {sources: sources.map( s => s.id), mineral: {type: minerals[0].mineralType, id: minerals[0].id }};
            }
        } 
    }

    public static setRoomType(roomName: string): void {
        const mapRoom = new MapRoom(roomName);
        if(Memory.rooms[roomName] == null){
            Memory.rooms[roomName] = {} as RoomMemory;
        }
        Memory.rooms[roomName].roomType = mapRoom.getRoomType();
    }

    public static setLastSeen(room: Room): void {
        if(room != null){
            if(room.memory.scouting == null){
                room.memory.scouting = {};
            }
            room.memory.scouting.lastSeen = Game.time;
        }
    }

    public static setBase(room: Room): void {
        if(room.memory != null){
            if(room.memory.roomType === 'NormalRoom'){
                if(room.memory.base == null){
                    // INIT new 
                    const transform = RoomPlannerUtils.doTransform(room.name);
                    if(transform.length > 0){
                        const anchor = RoomPlannerUtils.getMostCenterPos(transform);
                        if(anchor != null){
                            room.memory.base = {bunker: true, anchor};
                        }
                    } else {
                        room.memory.base = {bunker: false};
                    }
                }
            }
        }
    }

    public static isBaseSet(roomName: string): boolean {
        const roomMemory = Memory.rooms[roomName];
        if(roomMemory != null){
            if(roomMemory.base != null){
                if(roomMemory.base.bunker != null){
                    if(roomMemory.base.bunker === true){
                        if(roomMemory.base.anchor != null){
                            return true;
                        }
                    } else if(roomMemory.base.bunker === false){
                        if(roomMemory.base.anchor == null){
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}