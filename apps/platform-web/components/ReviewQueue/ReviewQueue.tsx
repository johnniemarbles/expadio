import { RiskBadge } from "@expadio/ui";
import type { ReviewItem } from "../../lib/contracts";
import styles from "./ReviewQueue.module.css";

export function ReviewQueue({ reviews }: { reviews: ReviewItem[] }) {
  return (
    <div className={styles.reviewList}>
      {reviews.map((review) => (
        <article className={styles.reviewItem} key={review.id}>
          <div className={styles.reviewIcon} aria-hidden="true">{review.category.slice(0, 1)}</div>
          <div className={styles.reviewCopy}>
            <strong>{review.title}</strong>
            <span>{review.requestedBy} · {review.age}</span>
          </div>
          <RiskBadge risk={review.risk} />
        </article>
      ))}
    </div>
  );
}
