// Ambient types kept inline in a `declare global` block so they travel with the one file that uses them.

declare global {
    interface PathfinderReturn {
        path: RoomPosition[];
        ops: number;
        cost: number;
        incomplete: boolean;
    }

    interface TravelToReturnData {
        nextPos?: RoomPosition;
        pathfinderReturn?: PathfinderReturn;
        state?: TravelState;
        path?: string;
    }

    // Returned by findTravelPath alongside the raw PathfinderReturn to record whether findRoute
    // constrained the search to a real room-level route, or the search ran blind against the raw
    // destination position with no room routing at all (see findTravelPath for when each happens).
    interface TravelPathResult extends PathfinderReturn {
        usedFindRoute: boolean;
    }

    interface TravelToOptions {
        ignoreRoads?: boolean;
        ignoreCreeps?: boolean;
        ignoreStructures?: boolean;
        preferHighway?: boolean;
        highwayBias?: number;
        allowHostile?: boolean;
        allowSK?: boolean;
        range?: number;
        obstacles?: Array<{ pos: RoomPosition }>;
        roomCallback?: (roomName: string, matrix: CostMatrix) => CostMatrix | boolean;
        routeCallback?: (roomName: string) => number;
        returnData?: TravelToReturnData;
        restrictDistance?: number;
        useFindRoute?: boolean;
        maxOps?: number;
        movingTarget?: boolean;
        freshMatrix?: boolean;
        offRoad?: boolean;
        stuckValue?: number;
        maxRooms?: number;
        repath?: number;
        route?: { [roomName: string]: boolean };
        ensurePath?: boolean;
    }

    interface TravelData {
        state: any[];
        path?: string;
    }

    interface TravelState {
        stuckCount: number;
        lastCoord: Coord & { roomName: string };
        destination: RoomPosition;
        cpu: number;
        blindPath: boolean;
        pendingRoomRepath: boolean;
    }

    interface Creep {
        travelTo(destination: HasPos | RoomPosition, ops?: TravelToOptions): number;
    }

    interface CreepMemory {
        _trav?: TravelData; // owned by lib/traveler.ts
    }

    interface RoomMemory {
        avoid?: number; // owned by lib/traveler.ts — room avoidance for pathing
    }

    interface Coord {
        x: number;
        y: number;
    }

    interface HasPos {
        pos: RoomPosition;
    }
}

export class Traveler {
    private static structureMatrixCache: { [roomName: string]: CostMatrix } = {};
    private static creepMatrixCache: { [roomName: string]: CostMatrix } = {};
    private static creepMatrixTick: number;
    private static structureMatrixTick: number;

    public static travelTo(creep: Creep, destination: HasPos | RoomPosition, options: TravelToOptions = {}): number {
        if (!destination) {
            return ERR_INVALID_ARGS;
        }

        if (creep.fatigue > 0) {
            Traveler.circle(creep.pos, "aqua", .3);
            return ERR_TIRED;
        }

        destination = this.normalizePos(destination);

        const rangeToDestination = creep.pos.getRangeTo(destination);
        if (options.range && rangeToDestination <= options.range) {
            return OK;
        } else if (rangeToDestination <= 1) {
            if (rangeToDestination === 1 && !options.range) {
                const direction = creep.pos.getDirectionTo(destination);
                if (options.returnData) {
                    options.returnData.nextPos = destination;
                    options.returnData.path = direction.toString();
                }
                return creep.move(direction);
            }
            return OK;
        }

        if (!creep.memory._trav) {
            creep.memory._trav = {} as TravelData;
        }
        const travelData = creep.memory._trav as TravelData;

        const state = this.deserializeState(travelData, destination);

        // The cached path was computed by a raw PathFinder.search with no room-level routing (short
        // hops skip findRoute — see findTravelPath), so it's a blind guess through any room the creep
        // didn't have vision of yet. Once the creep actually enters such a room, don't wait for the
        // stuck-counter to notice the guess was wrong: repath immediately using the now-visible room.
        // A path that WAS routed via findRoute is at least room-correct, so let the normal stuck logic
        // handle any in-room deviation for those instead of discarding a perfectly fine route.
        //
        // The repath is deferred until the creep is OFF the exit tile (see below), so "just crossed"
        // is latched into pendingRoomRepath rather than re-derived from lastCoord.roomName each tick —
        // by the tick the creep is off the border, lastCoord already reads the new room too, so a
        // same-tick comparison would never catch it. And the repath itself must not fire while still ON
        // the exit tile: a path computed there can legitimately step back across the border (the real
        // route curves along the edge), which would flip lastCoord.roomName back to the old room and
        // look like "just crossed" all over again — old room, new room, old room, forever.
        if (state.blindPath && travelData.path && state.lastCoord && creep.pos.roomName !== state.lastCoord.roomName) {
            state.pendingRoomRepath = true;
        }
        if (state.pendingRoomRepath && travelData.path && !this.isExit(creep.pos)) {
            delete travelData.path;
            state.pendingRoomRepath = false;
        }

        if (this.isStuck(creep, state)) {
            state.stuckCount++;
            Traveler.circle(creep.pos, "magenta", state.stuckCount * .2);
        } else {
            state.stuckCount = 0;
        }

        if (!options.stuckValue) { options.stuckValue = DEFAULT_STUCK_VALUE; }
        if (state.stuckCount >= options.stuckValue && Math.random() > .5) {
            options.ignoreCreeps = false;
            options.freshMatrix = true;
            delete travelData.path;
        }

        if (!this.samePos(state.destination, destination)) {
            if (options.movingTarget && state.destination.isNearTo(destination)) {
                if (travelData.path) {
                    travelData.path += state.destination.getDirectionTo(destination);
                }
                state.destination = destination;
            } else {
                delete travelData.path;
            }
        }

        if (options.repath && Math.random() < options.repath) {
            delete travelData.path;
        }

        let newPath = false;
        if (!travelData.path) {
            newPath = true;
            if (creep.spawning) { return ERR_BUSY; }

            state.destination = destination;

            const cpu = Game.cpu.getUsed();
            const ret = this.findTravelPath(creep.pos, destination, options);
            state.blindPath = !ret.usedFindRoute;

            const cpuUsed = Game.cpu.getUsed() - cpu;
            state.cpu = Math.round(cpuUsed + state.cpu);
            if (state.cpu > REPORT_CPU_THRESHOLD) {
                console.log(`TRAVELER: heavy cpu use: ${creep.name}, cpu: ${state.cpu} origin: ${
                    creep.pos}, dest: ${destination}`);
            }

            let color = "orange";
            if (ret.incomplete) {
                color = "red";
            }

            if (options.returnData) {
                options.returnData.pathfinderReturn = ret;
            }

            travelData.path = Traveler.serializePath(creep.pos, ret.path, color);
            state.stuckCount = 0;
        }

        this.serializeState(creep, destination, state, travelData);

        if (!travelData.path || travelData.path.length === 0) {
            return ERR_NO_PATH;
        }

        if (state.stuckCount === 0 && !newPath) {
            travelData.path = travelData.path.substr(1);
        }

        const nextDirection: DirectionConstant = parseInt(travelData.path[0], 10) as DirectionConstant;
        if (options.returnData) {
            if (nextDirection) {
                const nextPos = Traveler.positionAtDirection(creep.pos, nextDirection);
                if (nextPos) { options.returnData.nextPos = nextPos; }
            }
            options.returnData.state = state;
            options.returnData.path = travelData.path;
        }
        return creep.move(nextDirection);
    }

    public static normalizePos(destination: HasPos | RoomPosition): RoomPosition {
        if (!(destination instanceof RoomPosition)) {
            return destination.pos;
        }
        return destination;
    }

    public static checkAvoid(roomName: string) {
        return Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].avoid;
    }

    public static isExit(pos: Coord): boolean {
        return pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49;
    }

    public static sameCoord(pos1: Coord, pos2: Coord): boolean {
        return pos1.x === pos2.x && pos1.y === pos2.y;
    }

    public static samePos(pos1: RoomPosition, pos2: RoomPosition) {
        return this.sameCoord(pos1, pos2) && pos1.roomName === pos2.roomName;
    }

    public static circle(pos: RoomPosition, color: string, opacity?: number) {
        new RoomVisual(pos.roomName).circle(pos, {
            fill: "transparent", opacity, radius: .45, stroke: color, strokeWidth: .15
        });
    }

    public static updateRoomStatus(room: Room) {
        if (!room) { return; }
        if (room.controller) {
            if (room.controller.owner && !room.controller.my) {
                room.memory.avoid = 1;
            } else {
                delete room.memory.avoid;
            }
        }
    }

    public static findTravelPath(origin: RoomPosition | HasPos, destination: RoomPosition | HasPos,
                                 options: TravelToOptions = {}): TravelPathResult {

        if (options.ignoreCreeps === undefined) { options.ignoreCreeps = true; }
        if (options.maxOps === undefined) { options.maxOps = DEFAULT_MAXOPS; }
        if (options.range === undefined) { options.range = 1; }

        if (options.movingTarget) {
            options.range = 0;
        }

        origin = this.normalizePos(origin);
        destination = this.normalizePos(destination);
        const originRoomName = origin.roomName;
        const destRoomName = destination.roomName;

        const roomDistance = Game.map.getRoomLinearDistance(origin.roomName, destination.roomName);
        let allowedRooms = options.route;
        let usedFindRoute = false;
        if (!allowedRooms && (options.useFindRoute || (options.useFindRoute === undefined && roomDistance > 2))) {
            const route = this.findRoute(origin.roomName, destination.roomName, options);
            if (route) { allowedRooms = route; usedFindRoute = true; }
        }

        const callback = (roomName: string): CostMatrix | boolean => {

            if (allowedRooms) {
                if (!allowedRooms[roomName]) {
                    return false;
                }
            } else if (!options.allowHostile && Traveler.checkAvoid(roomName)
                && roomName !== destRoomName && roomName !== originRoomName) {
                return false;
            }

            let matrix;
            const room = Game.rooms[roomName];
            if (room) {
                if (options.ignoreStructures) {
                    matrix = new PathFinder.CostMatrix();
                    if (!options.ignoreCreeps) {
                        Traveler.addCreepsToMatrix(room, matrix);
                    }
                } else if (options.ignoreCreeps || roomName !== originRoomName) {
                    matrix = this.getStructureMatrix(room, options.freshMatrix);
                } else {
                    matrix = this.getCreepMatrix(room);
                }

                if (options.obstacles) {
                    matrix = matrix.clone();
                    for (const obstacle of options.obstacles) {
                        if (obstacle.pos.roomName !== roomName) { continue; }
                        matrix.set(obstacle.pos.x, obstacle.pos.y, 0xff);
                    }
                }
            }

            if (options.roomCallback) {
                if (!matrix) { matrix = new PathFinder.CostMatrix(); }
                const outcome = options.roomCallback(roomName, matrix.clone());
                if (outcome !== undefined) {
                    return outcome;
                }
            }

            return matrix as CostMatrix;
        };

        const ret = PathFinder.search(origin, { pos: destination, range: options.range! }, {
            maxOps: options.maxOps,
            maxRooms: options.maxRooms,
            plainCost: options.offRoad ? 1 : options.ignoreRoads ? 1 : 2,
            swampCost: options.offRoad ? 1 : options.ignoreRoads ? 5 : 10,
            roomCallback: callback,
        });

        if (ret.incomplete && options.ensurePath) {

            if (options.useFindRoute === undefined) {

                // Retry with findRoute for short hops that still needed an indirect path.
                if (roomDistance <= 2) {
                    console.log(`TRAVELER: path failed without findroute, trying with options.useFindRoute = true`);
                    console.log(`from: ${origin}, destination: ${destination}`);
                    options.useFindRoute = true;
                    const retryRet = this.findTravelPath(origin, destination, options);
                    console.log(`TRAVELER: second attempt was ${retryRet.incomplete ? "not " : ""}successful`);
                    return retryRet;
                }
            }
        }

        return { ...ret, usedFindRoute };
    }

    public static findRoute(origin: string, destination: string,
                            options: TravelToOptions = {}): { [roomName: string]: boolean } | void {

        const restrictDistance = options.restrictDistance || Game.map.getRoomLinearDistance(origin, destination) + 10;
        const allowedRooms = { [origin]: true, [destination]: true };

        let highwayBias = 1;
        if (options.preferHighway) {
            highwayBias = 2.5;
            if (options.highwayBias) {
                highwayBias = options.highwayBias;
            }
        }

        const ret = Game.map.findRoute(origin, destination, {
            routeCallback: (roomName: string) => {

                if (options.routeCallback) {
                    const outcome = options.routeCallback(roomName);
                    if (outcome !== undefined) {
                        return outcome;
                    }
                }

                const rangeToRoom = Game.map.getRoomLinearDistance(origin, roomName);
                if (rangeToRoom > restrictDistance) {
                    return Number.POSITIVE_INFINITY;
                }

                if (!options.allowHostile && Traveler.checkAvoid(roomName) &&
                    roomName !== destination && roomName !== origin) {
                    return Number.POSITIVE_INFINITY;
                }

                let parsed;
                if (options.preferHighway) {
                    parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName) as any;
                    const isHighway = (parsed[1] % 10 === 0) || (parsed[2] % 10 === 0);
                    if (isHighway) {
                        return 1;
                    }
                }
                // SK rooms are avoided when there is no vision in the room, harvested-from SK rooms are allowed
                if (!options.allowSK && !Game.rooms[roomName]) {
                    if (!parsed) { parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName) as any; }
                    const fMod = parsed[1] % 10;
                    const sMod = parsed[2] % 10;
                    const isSK = !(fMod === 5 && sMod === 5) &&
                        ((fMod >= 4) && (fMod <= 6)) &&
                        ((sMod >= 4) && (sMod <= 6));
                    if (isSK) {
                        return 10 * highwayBias;
                    }
                }

                return highwayBias;
            },
        });

        if (!Array.isArray(ret)) {
            console.log(`couldn't findRoute to ${destination}`);
            return;
        }
        for (const value of ret) {
            allowedRooms[value.room] = true;
        }

        return allowedRooms;
    }

    public static routeDistance(origin: string, destination: string): number | void {
        const linearDistance = Game.map.getRoomLinearDistance(origin, destination);
        if (linearDistance >= 32) {
            return linearDistance;
        }

        const allowedRooms = this.findRoute(origin, destination);
        if (allowedRooms) {
            return Object.keys(allowedRooms).length;
        }
    }

    // Cached for more than one tick. Requires vision.
    public static getStructureMatrix(room: Room, freshMatrix?: boolean): CostMatrix {
        if (!this.structureMatrixCache[room.name] || (freshMatrix && Game.time !== this.structureMatrixTick)) {
            this.structureMatrixTick = Game.time;
            const matrix = new PathFinder.CostMatrix();
            this.structureMatrixCache[room.name] = Traveler.addStructuresToMatrix(room, matrix, 1);
        }
        return this.structureMatrixCache[room.name];
    }

    // Cached for one tick. Requires vision.
    public static getCreepMatrix(room: Room) {
        if (!this.creepMatrixCache[room.name] || Game.time !== this.creepMatrixTick) {
            this.creepMatrixTick = Game.time;
            this.creepMatrixCache[room.name] = Traveler.addCreepsToMatrix(room,
                this.getStructureMatrix(room, true).clone());
        }
        return this.creepMatrixCache[room.name];
    }

    public static addStructuresToMatrix(room: Room, matrix: CostMatrix, roadCost: number): CostMatrix {

        const impassibleStructures: Structure[] = [];
        for (const structure of room.find<AnyStructure>(FIND_STRUCTURES)) {
            if (structure instanceof StructureRampart) {
                if (!structure.my && !structure.isPublic) {
                    impassibleStructures.push(structure);
                }
            } else if (structure instanceof StructureRoad) {
                matrix.set(structure.pos.x, structure.pos.y, roadCost);
            } else if (structure instanceof StructureContainer) {
                matrix.set(structure.pos.x, structure.pos.y, 5);
            } else {
                impassibleStructures.push(structure);
            }
        }

        for (const site of room.find(FIND_CONSTRUCTION_SITES)) {
            if (site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD
                || site.structureType === STRUCTURE_RAMPART) { continue; }
            matrix.set(site.pos.x, site.pos.y, 0xff);
        }

        // A mineral (with no extractor) is an impassable object, not a structure, so FIND_STRUCTURES
        // above never sees it. Without this the pathfinder routes straight through the mineral tile and
        // any creep whose path clips it (e.g. spawn→source past the bunker's mineral) stalls there
        // forever, issuing a move into the blocked tile every tick. It cold-starts the colony to death.
        for (const mineral of room.find(FIND_MINERALS)) {
            matrix.set(mineral.pos.x, mineral.pos.y, 0xff);
        }

        for (const structure of impassibleStructures) {
            matrix.set(structure.pos.x, structure.pos.y, 0xff);
        }

        return matrix;
    }

    public static addCreepsToMatrix(room: Room, matrix: CostMatrix): CostMatrix {
        room.find(FIND_CREEPS).forEach((creep: Creep) => matrix.set(creep.pos.x, creep.pos.y, 0xff));
        return matrix;
    }

    // Returns a string of directions. getDirectionTo works fine across a room border for two positions
    // that are still grid-adjacent (crossing an exit tile) — skipping the step there, as this used to,
    // silently drops the border-crossing move from the path. Every later direction is then walked from
    // the creep's real (pre-crossing) position instead of where the path assumed, so the creep executes
    // moves meant for the far side of the border while still standing on the near side: it never
    // actually crosses and instead drifts back and forth near the exit tile, forever re-triggering the
    // stuck/repath logic on the same broken path. Only same-room adjacency is skip-worthy (PathFinder
    // never emits a genuine same-room duplicate/teleport, so this should be unreachable in practice).
    public static serializePath(startPos: RoomPosition, path: RoomPosition[], color = "orange"): string {
        let serializedPath = "";
        let lastPosition = startPos;
        this.circle(startPos, color);
        for (const position of path) {
            new RoomVisual(position.roomName).line(position, lastPosition, { color, lineStyle: "dashed" });
            serializedPath += lastPosition.getDirectionTo(position);
            lastPosition = position;
        }
        return serializedPath;
    }

    public static positionAtDirection(origin: RoomPosition, direction: number): RoomPosition | void {
        const offsetX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
        const offsetY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
        const x = origin.x + offsetX[direction];
        const y = origin.y + offsetY[direction];
        if (x > 49 || x < 0 || y > 49 || y < 0) { return; }
        return new RoomPosition(x, y, origin.roomName);
    }

    private static deserializeState(travelData: TravelData, destination: RoomPosition): TravelState {
        const state = {} as TravelState;
        if (travelData.state) {
            state.lastCoord = {
                x: travelData.state[STATE_PREV_X],
                y: travelData.state[STATE_PREV_Y],
                roomName: travelData.state[STATE_PREV_ROOMNAME]
            };
            state.cpu = travelData.state[STATE_CPU];
            state.stuckCount = travelData.state[STATE_STUCK];
            state.destination = new RoomPosition(travelData.state[STATE_DEST_X], travelData.state[STATE_DEST_Y],
                travelData.state[STATE_DEST_ROOMNAME]);
            state.blindPath = !!travelData.state[STATE_BLIND_PATH];
            state.pendingRoomRepath = !!travelData.state[STATE_PENDING_ROOM_REPATH];
        } else {
            state.cpu = 0;
            state.destination = destination;
            state.blindPath = false;
            state.pendingRoomRepath = false;
        }
        return state;
    }

    private static serializeState(creep: Creep, destination: RoomPosition, state: TravelState, travelData: TravelData) {
        travelData.state = [creep.pos.x, creep.pos.y, state.stuckCount, state.cpu, destination.x, destination.y,
            destination.roomName, creep.pos.roomName, state.blindPath ? 1 : 0, state.pendingRoomRepath ? 1 : 0];
    }

    private static isStuck(creep: Creep, state: TravelState): boolean {
        let stuck = false;
        if (state.lastCoord !== undefined) {
            // roomName is absent on a _trav.state array serialized before this field existed (in-flight
            // creeps at deploy time) — RoomPosition throws on an undefined room name, so fall back to the
            // old room-blind comparison for exactly one tick until serializeState below rewrites the
            // array with all 8 slots and every following tick has it.
            const knowsRoom = state.lastCoord.roomName !== undefined;
            if (knowsRoom
                ? this.samePos(creep.pos, new RoomPosition(state.lastCoord.x, state.lastCoord.y, state.lastCoord.roomName))
                : this.sameCoord(creep.pos, state.lastCoord)) {
                stuck = true;
            } else if (
                (!knowsRoom || creep.pos.roomName === state.lastCoord.roomName) &&
                this.isExit(creep.pos) &&
                this.isExit(state.lastCoord)
            ) {
                // Camped on an exit tile without moving rooms — genuinely stuck. A creep that DID change
                // rooms this tick (both positions on an edge but roomName differs) just crossed the border
                // successfully; treating that as stuck forced a repath every single border crossing,
                // which reads as the creep bouncing back and forth between the two rooms forever.
                stuck = true;
            }
        }

        return stuck;
    }
}

// Lower this to help diagnose excessive repathing or failed pathing elsewhere in the code.
const REPORT_CPU_THRESHOLD = 1000;

const DEFAULT_MAXOPS = 20000;
const DEFAULT_STUCK_VALUE = 2;
const STATE_PREV_X = 0;
const STATE_PREV_Y = 1;
const STATE_STUCK = 2;
const STATE_CPU = 3;
const STATE_DEST_X = 4;
const STATE_DEST_Y = 5;
const STATE_DEST_ROOMNAME = 6;
const STATE_PREV_ROOMNAME = 7;
const STATE_BLIND_PATH = 8;
const STATE_PENDING_ROOM_REPATH = 9;

Creep.prototype.travelTo = function (destination: RoomPosition | { pos: RoomPosition }, options?: TravelToOptions) {
    return Traveler.travelTo(this, destination, options);
};
