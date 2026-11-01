import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt(), amount = in.nextInt();
        int[] coins = new int[n];
        for (int i = 0; i < n; i++) coins[i] = in.nextInt();
        int INF = 1_000_000_000;
        int[] best = new int[amount + 1];
        Arrays.fill(best, INF); best[0] = 0;
        for (int a = 1; a <= amount; a++)
            for (int c : coins)
                if (c <= a && best[a - c] + 1 < best[a]) best[a] = best[a - c] + 1;
        System.out.println(best[amount] >= INF ? -1 : best[amount]);
    }
}
