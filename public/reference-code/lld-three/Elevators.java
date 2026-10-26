package lldthree;

import java.util.*;

/** Deterministic floor/door event simulator. Not a real motor or certified safety controller. */
public final class Elevators {
    private Elevators() {}
    // region:contracts
    public enum Direction { UP, DOWN, IDLE }
    public enum Door { CLOSED, OPENING, OPEN, CLOSING }
    public enum Mode { NORMAL, OUT_OF_SERVICE }
    public enum CallState { WAITING, ASSIGNED, SERVED }
    public enum Action { IDLE, MOVED, OPENING, OPENED, CLOSING, CLOSED, BLOCKED, OUT_OF_SERVICE }
    public record HallKey(int floor,Direction direction) {}
    public record HallTask(long callId,HallKey key,long epoch) {}
    public record CallView(long id,HallKey key,long createdTick,CallState state,String carId,long epoch) {}
    public record CarSnapshot(String id,int floor,int capacity,int load,Direction heading,Direction boarding,
                              Door door,Mode mode,boolean obstructed,boolean interlock,
                              List<Integer> cabin,List<HallTask> hall) {
        public CarSnapshot { cabin=List.copyOf(cabin);hall=List.copyOf(hall); }
    }
    public record Tick(String carId,Action action,int from,int to,Direction heading,List<HallTask> pickups) {
        public Tick {pickups=List.copyOf(pickups);}
    }
    public interface DispatchPolicy { String choose(HallTask candidate,List<CarSnapshot> cars); }
    private record Goal(int floor,Direction boarding) {}
    // endregion:contracts

    private static final class SweepPlan {
        final NavigableSet<Integer> cabin=new TreeSet<>();
        final Map<Long,HallTask> hall=new LinkedHashMap<>();
        NavigableSet<Integer> halls(Direction d) {
            TreeSet<Integer> floors=new TreeSet<>();
            for(HallTask h:hall.values())if(h.key.direction==d)floors.add(h.key.floor);
            return floors;
        }
        // region:look
        Goal next(int floor, Direction heading) {
            TreeSet<Integer> up = new TreeSet<>(cabin);
            up.addAll(halls(Direction.UP));
            TreeSet<Integer> down = new TreeSet<>(cabin);
            down.addAll(halls(Direction.DOWN));
            if (up.isEmpty() && down.isEmpty()) {
                return null;
            }
            if (heading == Direction.IDLE) {
                TreeSet<Integer> all = new TreeSet<>(up);
                all.addAll(down);
                int closest = all.stream()
                    .min(Comparator.comparingInt((Integer f) -> Math.abs(f - floor))
                        .thenComparingInt(f -> f))
                    .orElseThrow();
                if (closest == floor) {
                    Direction boarding = halls(Direction.UP).contains(floor) ? Direction.UP
                        : halls(Direction.DOWN).contains(floor) ? Direction.DOWN : Direction.IDLE;
                    return new Goal(floor, boarding);
                }
                return next(floor, closest > floor ? Direction.UP : Direction.DOWN);
            }
            if (heading == Direction.UP) {
                Integer matching = up.ceiling(floor);
                if (matching != null) {
                    return new Goal(matching, Direction.UP);
                }
                if (!down.isEmpty() && down.last() > floor) {
                    return new Goal(down.last(), Direction.DOWN);
                }
                if (down.contains(floor)) {
                    return new Goal(floor, Direction.DOWN);
                }
                return next(floor, Direction.DOWN);
            }
            Integer matching = down.floor(floor);
            if (matching != null) {
                return new Goal(matching, Direction.DOWN);
            }
            if (!up.isEmpty() && up.first() < floor) {
                return new Goal(up.first(), Direction.UP);
            }
            if (up.contains(floor)) {
                return new Goal(floor, Direction.UP);
            }
            return next(floor, Direction.UP);
        }
        // endregion:look
    }
    private static final class Car {
        final String id;final int capacity;int floor,load;
        Direction heading=Direction.IDLE,boarding=Direction.IDLE;
        Door door=Door.CLOSED;Mode mode=Mode.NORMAL;boolean obstructed,interlock=true;
        final SweepPlan plan=new SweepPlan();
        Car(String id,int floor,int capacity){this.id=id;this.floor=floor;this.capacity=capacity;}
        Car(CarSnapshot s){this(s.id,s.floor,s.capacity);load=s.load;heading=s.heading;boarding=s.boarding;
            door=s.door;mode=s.mode;obstructed=s.obstructed;interlock=s.interlock;
            plan.cabin.addAll(s.cabin);for(HallTask h:s.hall)plan.hall.put(h.callId,h);}
        CarSnapshot snapshot(){return new CarSnapshot(id,floor,capacity,load,heading,boarding,door,mode,obstructed,interlock,new ArrayList<>(plan.cabin),new ArrayList<>(plan.hall.values()));}
        // region:tick
        Tick tick() {
            int from = floor;
            Action action;
            List<HallTask> pickups = List.of();
            if (mode == Mode.OUT_OF_SERVICE) {
                action = Action.OUT_OF_SERVICE;
            } else if (door == Door.OPENING) {
                door = Door.OPEN;
                action = Action.OPENED;
                plan.cabin.remove(floor);
                if (load < capacity) {
                    pickups = plan.hall.values().stream()
                        .filter(h -> h.key.floor == floor && h.key.direction == boarding)
                        .toList();
                }
            } else if (door == Door.OPEN) {
                if (obstructed || load > capacity) {
                    action = Action.BLOCKED;
                } else {
                    door = Door.CLOSING;
                    action = Action.CLOSING;
                }
            } else if (door == Door.CLOSING) {
                if (obstructed || load > capacity) {
                    door = Door.OPENING;
                    action = Action.OPENING;
                } else {
                    door = Door.CLOSED;
                    action = Action.CLOSED;
                }
            } else if (load > capacity) {
                door = Door.OPENING;
                action = Action.OPENING;
            } else if (obstructed || !interlock) {
                action = Action.BLOCKED;
            } else {
                Goal next = plan.next(floor, heading);
                if (next == null) {
                    heading = Direction.IDLE;
                    action = Action.IDLE;
                } else if (next.floor == floor) {
                    boarding = next.boarding;
                    heading = boarding;
                    door = Door.OPENING;
                    action = Action.OPENING;
                } else {
                    heading = next.floor > floor ? Direction.UP : Direction.DOWN;
                    floor += heading == Direction.UP ? 1 : -1;
                    action = Action.MOVED;
                }
            }
            return new Tick(id, action, from, floor, heading, pickups);
        }
        // endregion:tick
    }
    public static final class EtaPolicy implements DispatchPolicy {
        public static int estimate(HallTask probe,CarSnapshot snapshot) {
            if(snapshot.mode!=Mode.NORMAL||snapshot.load>=snapshot.capacity||snapshot.obstructed||!snapshot.interlock)return Integer.MAX_VALUE;
            Car simulated=new Car(snapshot);simulated.plan.hall.put(probe.callId,probe);
            for(int tick=1;tick<=10_000;tick++) {
                Tick result=simulated.tick();
                if(result.pickups.stream().anyMatch(h->h.callId==probe.callId))return tick;
                for(HallTask picked:result.pickups)simulated.plan.hall.remove(picked.callId,picked);
            }
            return Integer.MAX_VALUE;
        }
        @Override public String choose(HallTask call,List<CarSnapshot> cars) {
            return cars.stream().map(c->Map.entry(c,estimate(call,c)))
                .filter(e->e.getValue()!=Integer.MAX_VALUE)
                .min(Comparator.<Map.Entry<CarSnapshot,Integer>>comparingInt(Map.Entry::getValue).thenComparing(e->e.getKey().id))
                .map(e->e.getKey().id).orElse(null);
        }
    }
    private static final class Request {
        final long id,created;final HallKey key;CallState state=CallState.WAITING;String carId;long epoch;
        Request(long id,HallKey key,long created){this.id=id;this.key=key;this.created=created;}
        CallView view(){return new CallView(id,key,created,state,carId,epoch);}
    }
    public static final class SystemController {
        private final int floors;private final DispatchPolicy policy;
        private final Map<String,Car> cars=new LinkedHashMap<>();
        private final Map<Long,Request> requests=new LinkedHashMap<>();
        private final Map<HallKey,Long> active=new HashMap<>();private long nextId,tick;
        public SystemController(int floors,DispatchPolicy policy){if(floors<2||floors>100)throw new IllegalArgumentException("Simulator supports 2..100 floors");this.floors=floors;this.policy=Objects.requireNonNull(policy);}
        public synchronized void addCar(String id,int floor,int capacity){validFloor(floor);if(id==null||id.isBlank()||capacity<1||cars.containsKey(id))throw new IllegalArgumentException("Invalid car");cars.put(id,new Car(id,floor,capacity));dispatch();}
        // region:dispatch
        public synchronized CallView hallCall(int floor,Direction direction) {
            validFloor(floor);
            if(direction==null||direction==Direction.IDLE||floor==0&&direction==Direction.DOWN||floor==floors-1&&direction==Direction.UP)
                throw new IllegalArgumentException("Impossible hall direction");
            HallKey key=new HallKey(floor,direction);Long existing=active.get(key);
            if(existing!=null)return requests.get(existing).view();
            Request r=new Request(++nextId,key,tick);requests.put(r.id,r);active.put(key,r.id);dispatch();return r.view();
        }
        private void dispatch() {
            // Linked insertion order is oldest-first; an existing active call retains its age.
            for(Request r:requests.values())if(r.state==CallState.WAITING) {
                HallTask candidate=new HallTask(r.id,r.key,r.epoch+1);
                String id=policy.choose(candidate,cars.values().stream().map(Car::snapshot).toList());
                if(id==null)continue;Car c=car(id);
                if(c.mode!=Mode.NORMAL||c.load>=c.capacity||c.obstructed||!c.interlock)throw new IllegalStateException("Policy returned ineligible car");
                r.epoch++;r.carId=id;r.state=CallState.ASSIGNED;
                c.plan.hall.put(r.id,new HallTask(r.id,r.key,r.epoch));
            }
        }
        // endregion:dispatch
        public synchronized void cabinCall(String carId,int destination) {
            validFloor(destination);Car c=car(carId);
            if(c.mode!=Mode.NORMAL)throw new IllegalStateException("Car out of service");
            if(c.floor==destination&&c.door==Door.OPEN)return;
            c.plan.cabin.add(destination);
        }
        public synchronized List<Tick> tick() {
            tick++;List<Tick> results=new ArrayList<>();
            for(Car c:cars.values()) {
                Tick event=c.tick();results.add(event);
                for(HallTask picked:event.pickups)acknowledgePickup(picked.callId,c.id,picked.epoch);
            }
            dispatch();return List.copyOf(results);
        }
        // region:ownership
        public synchronized boolean acknowledgePickup(long callId, String carId, long epoch) {
            Request request = requests.get(callId);
            Car car = car(carId);
            if (request == null || request.state != CallState.ASSIGNED
                    || !carId.equals(request.carId) || request.epoch != epoch) {
                return false;
            }
            if (car.door != Door.OPEN || car.floor != request.key.floor
                    || car.boarding != request.key.direction || car.load >= car.capacity
                    || car.mode != Mode.NORMAL) {
                return false;
            }
            request.state = CallState.SERVED;
            active.remove(request.key, request.id);
            car.plan.hall.remove(callId, new HallTask(callId, request.key, epoch));
            return true;
        }
        public synchronized void outOfService(String carId) {
            Car car = car(carId);
            car.mode = Mode.OUT_OF_SERVICE;
            releaseHallCalls(car);
            dispatch();
            // Cabin destinations remain: existing passengers require an operator recovery procedure.
        }
        private void releaseHallCalls(Car car) {
            for (HallTask task : new ArrayList<>(car.plan.hall.values())) {
                Request request = requests.get(task.callId);
                if (request != null && request.state == CallState.ASSIGNED
                        && car.id.equals(request.carId) && request.epoch == task.epoch) {
                    request.state = CallState.WAITING;
                    request.carId = null;
                    request.epoch++;
                }
            }
            car.plan.hall.clear();
        }
        // endregion:ownership
        public synchronized void load(String carId,int passengers){if(passengers<0)throw new IllegalArgumentException("Negative load");Car c=car(carId);c.load=passengers;if(passengers>=c.capacity)releaseHallCalls(c);dispatch();}
        public synchronized void obstruction(String carId,boolean value){Car c=car(carId);c.obstructed=value;if(value)releaseHallCalls(c);dispatch();}
        public synchronized void interlock(String carId,boolean value){Car c=car(carId);c.interlock=value;if(!value)releaseHallCalls(c);dispatch();}
        public synchronized CarSnapshot snapshot(String carId){return car(carId).snapshot();}
        public synchronized CallView call(long id){Request r=requests.get(id);if(r==null)throw new IllegalArgumentException("Unknown call");return r.view();}
        public synchronized long currentTick(){return tick;}
        private Car car(String id){Car c=cars.get(id);if(c==null)throw new IllegalArgumentException("Unknown car");return c;}
        private void validFloor(int f){if(f<0||f>=floors)throw new IllegalArgumentException("Floor outside building");}
    }
}
