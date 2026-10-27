package kb.snakeladder;

import java.util.*;
import java.util.function.IntSupplier;

// region:board
/** A snake (end below start) or a ladder (end above start). */
record Jump(int start, int end) {
    boolean isSnake() { return end < start; }
}

class Board {
    private final int size;
    private final Map<Integer, Integer> jumps = new HashMap<>();

    Board(int size, List<Jump> list) {
        this.size = size;
        for (Jump j : list) {
            if (j.start() <= 1 || j.start() >= size || j.end() < 1 || j.end() > size)
                throw new IllegalArgumentException("Jump off the board: " + j);
            if (jumps.putIfAbsent(j.start(), j.end()) != null)
                throw new IllegalArgumentException("Two jumps start at " + j.start());
        }
        for (Jump j : list)                                 // one jump per landing, no chains
            if (jumps.containsKey(j.end()))
                throw new IllegalArgumentException("Jump ends on another jump: " + j);
    }
    int size()                   { return size; }
    int afterJump(int cell)      { return jumps.getOrDefault(cell, cell); }
}
// endregion:board

// region:dice
interface Dice { int roll(); }

class RandomDice implements Dice {
    private final Random random = new Random();
    public int roll() { return random.nextInt(6) + 1; }
}

/** For tests and replays: returns a fixed sequence of rolls. */
class FixedDice implements Dice {
    private final Iterator<Integer> rolls;
    FixedDice(Integer... rolls) { this.rolls = List.of(rolls).iterator(); }
    public int roll() { return rolls.next(); }
}
// endregion:dice

// region:game
record Player(String name) {}

record Move(Player player, int roll, int from, int to, String note) {}

class Game {
    private final Board board;
    private final Dice dice;
    private final Deque<Player> turns;
    private final Map<Player, Integer> position = new HashMap<>();
    private Player winner;

    Game(Board board, Dice dice, List<Player> players) {
        if (players.size() < 2) throw new IllegalArgumentException("Need at least 2 players");
        this.board = board; this.dice = dice; this.turns = new ArrayDeque<>(players);
        players.forEach(p -> position.put(p, 0));           // everyone starts off the board
    }

    Move playTurn() {
        if (winner != null) throw new IllegalStateException(winner.name() + " already won");
        Player p = turns.pollFirst();
        int roll = dice.roll(), from = position.get(p), target = from + roll;
        String note;
        int to;
        if (target > board.size()) { to = from; note = "needs exact roll"; }
        else {
            to = board.afterJump(target);
            note = to > target ? "ladder" : to < target ? "snake" : "";
        }
        position.put(p, to);
        if (to == board.size()) winner = p; else turns.addLast(p);
        return new Move(p, roll, from, to, note);
    }

    Optional<Player> winner() { return Optional.ofNullable(winner); }
    int positionOf(Player p)  { return position.get(p); }
}
// endregion:game

public class SnakeLadderDemo {
    public static void main(String[] args) {
        Board board = new Board(100, List.of(
                new Jump(4, 25), new Jump(40, 89),          // ladders
                new Jump(27, 5), new Jump(99, 41)));        // snakes
        Player asha = new Player("Asha"), bilal = new Player("Bilal");
        Game game = new Game(board, new FixedDice(4, 6, 2, 1), List.of(asha, bilal));

        Move m1 = game.playTurn();
        check(m1.to() == 25 && m1.note().equals("ladder"), "Asha 0+4 = 4, ladder to 25");
        Move m2 = game.playTurn();
        check(m2.to() == 6, "Bilal 0+6 = 6");
        Move m3 = game.playTurn();
        check(m3.to() == 5 && m3.note().equals("snake"), "Asha 25+2 = 27, snake to 5");
        game.playTurn();
        check(game.positionOf(bilal) == 7, "Bilal 6+1 = 7");

        // A 10-cell board to play a whole game quickly
        Board small = new Board(10, List.of(new Jump(3, 8), new Jump(9, 2)));
        Game quick = new Game(small, new FixedDice(3, 2, 4, 1, 2), List.of(asha, bilal));
        check(quick.playTurn().to() == 8, "Asha 3, ladder to 8");
        check(quick.playTurn().to() == 2, "Bilal 2");
        Move over = quick.playTurn();
        check(over.to() == 8 && over.note().equals("needs exact roll"), "8+4 = 12 > 10");
        check(quick.playTurn().to() == 8, "Bilal 2+1 = 3, ladder to 8");
        check(quick.playTurn().to() == 10 && quick.winner().orElseThrow() == asha, "Asha wins");
        try { quick.playTurn(); check(false, "game over"); }
        catch (IllegalStateException expected) { }

        try { new Board(10, List.of(new Jump(3, 8), new Jump(8, 2))); check(false, "chain"); }
        catch (IllegalArgumentException expected) { }
        try { new Board(10, List.of(new Jump(10, 2))); check(false, "jump from last cell"); }
        catch (IllegalArgumentException expected) { }
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
