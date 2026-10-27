package kb.tictactoegame;

import java.util.Arrays;

// region:enums
enum Symbol { X, O, EMPTY }
enum GameStatus { IN_PROGRESS, X_WON, O_WON, DRAW }
enum Decision { ACCEPTED, GAME_OVER, WRONG_TURN, OUT_OF_BOUNDS, OCCUPIED }

record Player(String name, Symbol symbol) {}
// endregion:enums

// region:board
class Board {
    private final int n;
    private final Symbol[][] cells;

    Board(int n) {
        this.n = n;
        cells = new Symbol[n][n];
        for (Symbol[] row : cells) Arrays.fill(row, Symbol.EMPTY);
    }

    int size()                         { return n; }
    boolean isInside(int r, int c)     { return r >= 0 && r < n && c >= 0 && c < n; }
    boolean isEmpty(int r, int c)      { return cells[r][c] == Symbol.EMPTY; }
    void place(int r, int c, Symbol s) { cells[r][c] = s; }

    /** A new win must pass through the cell just played: check only its lines. */
    boolean winsThrough(int r, int c, Symbol s) {
        return line(r, 0, 0, 1, s)                              // row r
            || line(0, c, 1, 0, s)                              // column c
            || (r == c && line(0, 0, 1, 1, s))                  // main diagonal
            || (r + c == n - 1 && line(0, n - 1, 1, -1, s));    // other diagonal
    }

    private boolean line(int r, int c, int dr, int dc, Symbol s) {
        for (int i = 0; i < n; i++) {
            if (cells[r + i * dr][c + i * dc] != s) return false;
        }
        return true;
    }

    String row(int r) {
        StringBuilder sb = new StringBuilder();
        for (Symbol s : cells[r]) sb.append(s == Symbol.EMPTY ? '.' : s.name().charAt(0));
        return sb.toString();
    }
}
// endregion:board

// region:game
class Game {
    private final Board board;
    private final Player[] players;
    private int current = 0;                       // index of the player to move; X first
    private int moves = 0;
    private GameStatus status = GameStatus.IN_PROGRESS;

    Game(int size, Player x, Player o) {
        board = new Board(size);
        players = new Player[] { x, o };
    }

    synchronized Decision makeMove(Player player, int row, int col) {
        // 1. Validate everything first. A rejected move changes nothing.
        if (status != GameStatus.IN_PROGRESS) return Decision.GAME_OVER;
        if (player != players[current])       return Decision.WRONG_TURN;
        if (!board.isInside(row, col))        return Decision.OUT_OF_BOUNDS;
        if (!board.isEmpty(row, col))         return Decision.OCCUPIED;

        // 2. Change state.
        Symbol s = player.symbol();
        board.place(row, col, s);
        moves++;

        // 3. Decide the result: win before draw, then switch turns.
        if (board.winsThrough(row, col, s)) {
            status = (s == Symbol.X) ? GameStatus.X_WON : GameStatus.O_WON;
        } else if (moves == board.size() * board.size()) {
            status = GameStatus.DRAW;
        } else {
            current = 1 - current;
        }
        return Decision.ACCEPTED;
    }

    GameStatus getStatus() { return status; }
    Board getBoard()       { return board; }
}
// endregion:game

// region:counters
/** O(1) win check for N x N: X adds +1, O adds -1 to its row, column and diagonals. */
class WinCounters {
    private final int n;
    private final int[] rows, cols;
    private int diag, antiDiag;

    WinCounters(int n) { this.n = n; rows = new int[n]; cols = new int[n]; }

    boolean record(int r, int c, Symbol s) {
        int v = (s == Symbol.X) ? 1 : -1;
        rows[r] += v;
        cols[c] += v;
        if (r == c) diag += v;
        if (r + c == n - 1) antiDiag += v;
        return Math.abs(rows[r]) == n || Math.abs(cols[c]) == n
            || Math.abs(diag) == n || Math.abs(antiDiag) == n;
    }
}
// endregion:counters

public class TicTacToeDemo {
    public static void main(String[] args) {
        Player asha = new Player("Asha", Symbol.X), bilal = new Player("Bilal", Symbol.O);
        Game game = new Game(3, asha, bilal);
        check(game.makeMove(asha, 0, 0) == Decision.ACCEPTED, "X top-left");
        check(game.makeMove(bilal, 0, 0) == Decision.OCCUPIED, "occupied");
        check(game.makeMove(asha, 1, 1) == Decision.WRONG_TURN, "still O's turn");
        check(game.makeMove(bilal, 3, 0) == Decision.OUT_OF_BOUNDS, "outside");
        game.makeMove(bilal, 1, 0); game.makeMove(asha, 0, 1); game.makeMove(bilal, 1, 1);
        check(game.makeMove(asha, 0, 2) == Decision.ACCEPTED && game.getStatus() == GameStatus.X_WON, "row 0");
        check(game.makeMove(bilal, 2, 2) == Decision.GAME_OVER, "game over");
        check(game.getBoard().row(0).equals("XXX") && game.getBoard().row(1).equals("OO."), "board");

        // ninth move wins: win is checked before draw
        Game g = new Game(3, asha, bilal);
        int[][] seq = {{0,0},{0,1},{0,2},{1,0},{1,1},{1,2},{2,1},{2,0},{2,2}};
        for (int i = 0; i < seq.length; i++) g.makeMove(i % 2 == 0 ? asha : bilal, seq[i][0], seq[i][1]);
        check(g.getStatus() == GameStatus.X_WON, "ninth-move win, not draw");

        WinCounters wc = new WinCounters(3);
        wc.record(0, 0, Symbol.X); wc.record(1, 1, Symbol.X);
        check(wc.record(2, 2, Symbol.X), "diagonal via counters");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
